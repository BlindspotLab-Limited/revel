# Launch a tiny Ubuntu EC2 for OKX A2A daemon (Revel agent online).
# Prereq: aws configure  (access key + secret + region)
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/aws-launch-a2a-ec2.ps1

$ErrorActionPreference = "Stop"
$Region = if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }
$KeyName = "revel-a2a"
$KeyPath = Join-Path $env:USERPROFILE ".ssh\revel-a2a.pem"
$InstanceType = "t3.micro"
$NameTag = "revel-a2a"

Write-Host "==> Identity"
aws sts get-caller-identity --region $Region | Out-Host

Write-Host "==> Region $Region | type $InstanceType"

# Key pair
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE ".ssh") | Out-Null
$existingKey = aws ec2 describe-key-pairs --region $Region --key-names $KeyName 2>$null
if ($LASTEXITCODE -eq 0 -and $existingKey) {
  Write-Host "Key pair $KeyName already exists in AWS."
  if (-not (Test-Path $KeyPath)) {
    Write-Host "WARNING: local $KeyPath missing. Delete key in console or use another name."
    throw "No local PEM for existing key $KeyName"
  }
} else {
  Write-Host "Creating key pair $KeyName -> $KeyPath"
  aws ec2 create-key-pair --region $Region --key-name $KeyName --query "KeyMaterial" --output text |
    Set-Content -Path $KeyPath -Encoding ascii
  icacls $KeyPath /inheritance:r | Out-Null
  icacls $KeyPath /grant:r "$($env:USERNAME):(R)" | Out-Null
}

# Default VPC + subnet
$VpcId = aws ec2 describe-vpcs --region $Region --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text
if (-not $VpcId -or $VpcId -eq "None") { throw "No default VPC in $Region" }
$SubnetId = aws ec2 describe-subnets --region $Region --filters "Name=vpc-id,Values=$VpcId" --query "Subnets[0].SubnetId" --output text
Write-Host "VPC=$VpcId Subnet=$SubnetId"

# Security group
$SgName = "revel-a2a-sg"
$SgId = aws ec2 describe-security-groups --region $Region --filters "Name=group-name,Values=$SgName" "Name=vpc-id,Values=$VpcId" --query "SecurityGroups[0].GroupId" --output text 2>$null
if (-not $SgId -or $SgId -eq "None") {
  $SgId = aws ec2 create-security-group --region $Region --group-name $SgName --description "SSH for revel a2a daemon" --vpc-id $VpcId --query "GroupId" --output text
  $MyIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
  aws ec2 authorize-security-group-ingress --region $Region --group-id $SgId --protocol tcp --port 22 --cidr "$MyIp/32" | Out-Null
  Write-Host "SG=$SgId (SSH from $MyIp/32)"
} else {
  Write-Host "SG=$SgId (existing)"
}

# Ubuntu 24.04 amd64
$Ami = aws ec2 describe-images --region $Region --owners 099720109477 `
  --filters "Name=name,Values=ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-amd64-server-*" "Name=state,Values=available" `
  --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text
Write-Host "AMI=$Ami"

# User data bootstrap
$UserData = @'
#!/bin/bash
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install -g @okxweb3/a2a-node@latest pm2
# onchainos linux
curl -fsSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | bash || true
echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/ubuntu/.bashrc
chown -R ubuntu:ubuntu /home/ubuntu || true
'@

$UserDataFile = Join-Path $env:TEMP "revel-a2a-userdata.sh"
Set-Content -Path $UserDataFile -Value $UserData -Encoding utf8NoBOM

# Already running?
$Existing = aws ec2 describe-instances --region $Region `
  --filters "Name=tag:Name,Values=$NameTag" "Name=instance-state-name,Values=pending,running" `
  --query "Reservations[].Instances[].InstanceId" --output text
if ($Existing -and $Existing.Trim()) {
  $InstanceId = ($Existing -split "\s+")[0]
  Write-Host "Instance already running: $InstanceId"
} else {
  Write-Host "Launching $InstanceType..."
  $InstanceId = aws ec2 run-instances --region $Region `
    --image-id $Ami `
    --instance-type $InstanceType `
    --key-name $KeyName `
    --security-group-ids $SgId `
    --subnet-id $SubnetId `
    --associate-public-ip-address `
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}" `
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NameTag}]" `
    --user-data "file://$UserDataFile" `
    --query "Instances[0].InstanceId" --output text
  Write-Host "InstanceId=$InstanceId"
  aws ec2 wait instance-running --region $Region --instance-ids $InstanceId
}

$PublicIp = aws ec2 describe-instances --region $Region --instance-ids $InstanceId `
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "InstanceId : $InstanceId"
Write-Host "Public IP  : $PublicIp"
Write-Host "Key        : $KeyPath"
Write-Host "SSH        : ssh -i `"$KeyPath`" ubuntu@$PublicIp"
Write-Host ""
Write-Host "After SSH (wait ~2 min for user-data):"
Write-Host "  export PATH=`"`$HOME/.local/bin:`$PATH`""
Write-Host "  onchainos wallet login"
Write-Host "  okx-a2a doctor --fix"
Write-Host "  okx-a2a daemon start"
Write-Host "  # then pm2 keep-alive (see docs)"
Write-Host ""

# Save connection info
$Out = Join-Path $env:USERPROFILE ".ssh\revel-a2a-connection.txt"
@"
InstanceId=$InstanceId
PublicIp=$PublicIp
Region=$Region
KeyPath=$KeyPath
SSH=ssh -i `"$KeyPath`" ubuntu@$PublicIp
"@ | Set-Content $Out
Write-Host "Saved: $Out"
