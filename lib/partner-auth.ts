import { extractPartnerApiKey, hashPartnerApiKey } from "@/lib/partner-keys";
import { getPrisma } from "@/lib/prisma";
import { runInBackground } from "@/lib/runtime/cloudflare";

export type PartnerAccessType = "paid" | "whitelisted" | "trial";
export type PartnerStatus = "pending" | "active" | "suspended";

export type AuthenticatedPartner = {
  id: string;
  name: string;
  domain: string | null;
  status: PartnerStatus;
  accessType: PartnerAccessType;
  creditsBalance: number;
  monthlyQuota: number | null;
  apiKeyId: string;
};

export async function authenticatePartnerRequest(
  request: Request
): Promise<AuthenticatedPartner | null> {
  const rawKey = extractPartnerApiKey(request);
  if (!rawKey) return null;

  const prisma = getPrisma();
  if (!prisma) return null;

  const prefix = rawKey.slice(0, 20);
  const hash = hashPartnerApiKey(rawKey);

  const record = await prisma.partnerApiKey.findFirst({
    where: {
      keyPrefix: prefix,
      keyHash: hash,
      revokedAt: null,
    },
    include: { partner: true },
  });

  if (!record?.partner) return null;

  runInBackground(
    prisma.partnerApiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
  );

  const partner = record.partner;
  return {
    id: partner.id,
    name: partner.name,
    domain: partner.domain,
    status: partner.status as PartnerStatus,
    accessType: partner.accessType as PartnerAccessType,
    creditsBalance: partner.creditsBalance,
    monthlyQuota: partner.monthlyQuota,
    apiKeyId: record.id,
  };
}

export function partnerUnauthorizedResponse(): Response {
  return Response.json(
    {
      error: "Unauthorized",
      hint: "Set Authorization: Bearer rvl_pk_... or X-Revel-Partner-Key header",
      docs: "https://tryrevel.xyz/partners",
    },
    { status: 401 }
  );
}