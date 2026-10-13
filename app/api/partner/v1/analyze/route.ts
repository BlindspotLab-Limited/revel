import { NextResponse } from "next/server";
import { runWithActivityContext } from "@/lib/activity-context";
import { trackActivity } from "@/lib/activity";
import {
  authenticatePartnerRequest,
  partnerUnauthorizedResponse,
} from "@/lib/partner-auth";
import { getOkxAuditPriceUsd } from "@/lib/billing/okx-x402";
import { siteConfig } from "@/lib/site-config";
import {
  checkPartnerBilling,
  reservePartnerCredit,
} from "@/lib/partner-billing";
import { partnerRateLimit } from "@/lib/partner-rate-limit";
import { linkPartnerAnalysis } from "@/lib/partners";
import { startWebsiteAnalysis } from "@/lib/mcp/handlers";
import { normalizeUrlSafe } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Revel-Partner-Key",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const partner = await authenticatePartnerRequest(request);
  if (!partner) {
    return applyCors(partnerUnauthorizedResponse());
  }

  const billing = checkPartnerBilling(partner);
  if (!billing.allowed) {
    return applyCors(
      NextResponse.json(
        {
          error: billing.error,
          hint: billing.hint,
          priceUsd: billing.priceUsd,
        },
        { status: billing.status }
      )
    );
  }

  if (billing.mode === "credits") {
    const reserved = await reservePartnerCredit(partner.id);
    if (!reserved) {
      return applyCors(
        NextResponse.json(
          {
            error: "Partner credits required",
            hint: `Top up credits via admin or pay per audit. Contact ${siteConfig.organization.email}`,
            priceUsd: getOkxAuditPriceUsd(),
          },
          { status: 402 }
        )
      );
    }
  }

  const { success } = partnerRateLimit(partner.id);
  if (!success) {
    return applyCors(
      NextResponse.json(
        { error: "Rate limit exceeded. Try again in a minute." },
        { status: 429 }
      )
    );
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return applyCors(
      NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    );
  }

  const url = body.url?.trim();
  if (!url) {
    return applyCors(
      NextResponse.json({ error: "url is required" }, { status: 400 })
    );
  }

  try {
    const website = await normalizeUrlSafe(url);

    return runWithActivityContext(
      { source: "partner_api", paid: billing.mode === "credits" },
      async () => {
        const started = await startWebsiteAnalysis(website);
        await linkPartnerAnalysis(partner.id, started.analysisId);

        trackActivity({
          eventType: "analysis_started",
          source: "partner_api",
          analysisId: started.analysisId,
          website,
          status: "started",
          metadata: {
            partnerId: partner.id,
            partnerName: partner.name,
            billingMode: billing.mode,
          },
        });

        // `startWebsiteAnalysis` already schedules the run via `after()`.
        // Scheduling it again here executed the whole AI pipeline twice for
        // every partner request — double provider spend and a write race on
        // the same analysis row.

        return applyCors(
          NextResponse.json({
            analysisId: started.analysisId,
            website: started.website,
            status: started.status,
            message: started.message,
            poll: `/api/partner/v1/report/${started.analysisId}`,
            partner: { name: partner.name, billingMode: billing.mode },
          })
        );
      }
    );
  } catch (error) {
    const { logServerError, toClientErrorMessage } = await import(
      "@/lib/safe-client-error"
    );
    logServerError("partner_analyze_start_failed", error);
    return applyCors(
      NextResponse.json(
        {
          error: toClientErrorMessage(error, "Could not start analysis"),
        },
        { status: 400 }
      )
    );
  }
}

function applyCors(response: Response): NextResponse {
  const next = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const [key, value] of Object.entries(corsHeaders)) {
    next.headers.set(key, value);
  }
  return next;
}