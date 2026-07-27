import { getOkxBillingHealth } from "@/lib/billing/okx-x402";
import { siteConfig } from "@/lib/site-config";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  const health = await getOkxBillingHealth();

  return Response.json(
    {
      service: "revel",
      status: "ok",
      appUrl: siteConfig.url,
      okxBilling: health,
    },
    { headers: corsHeaders }
  );
}
