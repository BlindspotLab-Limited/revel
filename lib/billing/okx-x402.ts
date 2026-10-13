import { OKXFacilitatorClient } from "@okxweb3/app-x402-core";
import {
  x402ResourceServer,
  type RouteConfig,
} from "@okxweb3/app-x402-core/server";
import { ExactEvmScheme } from "@okxweb3/app-x402-evm/exact/server";
import {
  getPayoutSummary,
  isPayoutConfigured,
  validatePayoutConfig,
} from "@/lib/billing/payout-config";
import { siteConfig } from "@/lib/site-config";

/** X Layer mainnet — OKX Onchain OS payments */
export const OKX_X402_NETWORK = "eip155:196" as const;

/** USDT0 on X Layer (6 decimals) */
export const OKX_USDT0_ADDRESS =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";

/** Default launch price — covers LLM fallback + Vercel + maintenance margin */
export const DEFAULT_OKX_AUDIT_PRICE_USD = 0.35;

let resourceServer: x402ResourceServer | null = null;
let initialized = false;

export function isOkxBillingEnabled(): boolean {
  return Boolean(
    process.env.OKX_API_KEY?.trim() &&
      process.env.OKX_SECRET_KEY?.trim() &&
      process.env.OKX_PASSPHRASE?.trim() &&
      // A malformed or forbidden payee must disable billing outright rather
      // than be advertised and collect funds at an unrecoverable address.
      isPayoutConfigured()
  );
}

export function getOkxAuditPriceUsd(): number {
  const raw = Number(process.env.OKX_AUDIT_PRICE_USD ?? DEFAULT_OKX_AUDIT_PRICE_USD);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_OKX_AUDIT_PRICE_USD;
  return Math.min(raw, 10);
}

export function getOkxAuditPriceLabel(): string {
  const usd = getOkxAuditPriceUsd();
  return `$${usd.toFixed(2)}`;
}

export function getOkxPayTo(): string | undefined {
  const result = validatePayoutConfig();
  return result.ok ? result.config.address : undefined;
}

/** Throws rather than let an unvalidated payee reach a payment challenge. */
function requirePayout() {
  const result = validatePayoutConfig();
  if (!result.ok) {
    throw new Error(`Invalid payout configuration: ${result.errors.join(" ")}`);
  }
  return result.config;
}

export function getOkxBillingManifest() {
  const priceUsd = getOkxAuditPriceUsd();
  const mcpEndpoint = `${siteConfig.url}/api/mcp`;
  return {
    protocol: "x402",
    agentPaymentsProtocol: "okx-agent-payments-protocol",
    network: OKX_X402_NETWORK,
    /**
     * Charged when a billable tool is invoked, i.e. per audit REQUEST.
     * Previously advertised as "completed_audit" while the charge actually
     * happened on start — an inaccurate billing claim, now corrected.
     */
    unit: "audit_request",
    priceUsd,
    priceDisplay: `$${priceUsd.toFixed(2)}`,
    currency: "USDT0",
    tokenAddress: OKX_USDT0_ADDRESS,
    endpoint: mcpEndpoint,
    alternateEndpoint: `${siteConfig.url}/api/audit`,
    /** Receiving address, network and asset actually in force. */
    payout: getPayoutSummary(),
    /** Credentials present in the environment. */
    configured: isOkxBillingEnabled(),
    /** Facilitator has accepted those credentials in this process. */
    operational: isOkxBillingOperational(),
    enabled: isOkxBillingEnabled(),
    note: "OKX Agent Payments Protocol (x402) on billable MCP tools only (revel_analyze_website*). initialize/tools/list/health/poll/export stay free. One charge per audit request; see refundPolicy for failed audits.",
    refundPolicy:
      "A request that fails before a report is produced is refundable on request to hello@mail.tryrevel.xyz. Partial-coverage reports (some pages unreachable) are delivered and charged, and the report states which pages failed.",
  };
}

export type OkxBillingHealthStatus = {
  enabled: boolean;
  configured: boolean;
  status: "healthy" | "disabled" | "misconfigured" | "error";
  priceUsd: number;
  priceDisplay: string;
  payTo?: string;
  network: string;
  endpoint: string;
  alternateEndpoint: string;
  note: string;
  error?: string;
};

export function getOkxBillingHealthSnapshot(): OkxBillingHealthStatus {
  const hasApiKey = Boolean(process.env.OKX_API_KEY?.trim());
  const hasSecretKey = Boolean(process.env.OKX_SECRET_KEY?.trim());
  const hasPassphrase = Boolean(process.env.OKX_PASSPHRASE?.trim());
  const payout = validatePayoutConfig();
  const hasPayTo = payout.ok;
  const configured = hasApiKey || hasSecretKey || hasPassphrase || hasPayTo;
  const enabled = hasApiKey && hasSecretKey && hasPassphrase && hasPayTo;
  const manifest = getOkxBillingManifest();

  return {
    enabled,
    configured,
    status: enabled ? "healthy" : configured ? "misconfigured" : "disabled",
    priceUsd: manifest.priceUsd,
    priceDisplay: manifest.priceDisplay,
    payTo: getOkxPayTo(),
    network: manifest.network,
    endpoint: manifest.endpoint,
    alternateEndpoint: manifest.alternateEndpoint,
    note: manifest.note,
  };
}

export async function getOkxBillingHealth(): Promise<OkxBillingHealthStatus> {
  const snapshot = getOkxBillingHealthSnapshot();

  if (!snapshot.enabled) {
    return snapshot;
  }

  try {
    await ensureOkxResourceServerReady();
    return snapshot;
  } catch (error) {
    return {
      ...snapshot,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown OKX billing error",
    };
  }
}

/**
 * @deprecated Do not pass to withX402 for API/MCP routes.
 * Browser HTML paywalls omit PAYMENT-REQUIRED and fail OKX marketplace x402 validation.
 * Prefer no paywallConfig so all clients get JSON 402 + PAYMENT-REQUIRED header.
 */
export function getOkxPaywallConfig() {
  return {
    appName: "Revel",
    appLogo: `${siteConfig.url}/brand/revel-icon-256.png`,
  };
}

export function getMcpRouteConfig(): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: requirePayout().network,
      payTo: requirePayout().address,
      price: getOkxAuditPriceLabel(),
      maxTimeoutSeconds: 300,
    },
    description:
      "Revel A2MCP — one charge per audit request (Reveal Index, Blueprint, Action Queue)",
    mimeType: "application/json",
  };
}

export function getOkxResourceServer(): x402ResourceServer {
  if (!isOkxBillingEnabled()) {
    throw new Error("OKX billing is not configured");
  }

  if (!resourceServer) {
    const facilitator = new OKXFacilitatorClient({
      apiKey: process.env.OKX_API_KEY!,
      secretKey: process.env.OKX_SECRET_KEY!,
      passphrase: process.env.OKX_PASSPHRASE!,
      syncSettle: true,
    });

    resourceServer = new x402ResourceServer(facilitator).register(
      OKX_X402_NETWORK,
      new ExactEvmScheme()
    );
  }

  return resourceServer;
}

export async function ensureOkxResourceServerReady(): Promise<void> {
  if (!isOkxBillingEnabled() || initialized) return;
  await getOkxResourceServer().initialize();
  initialized = true;
}

/** Cached negative result so a broken facilitator is not probed per request. */
let lastInitFailure: { at: number; error: string } | null = null;
const INIT_FAILURE_TTL_MS = 30_000;

export type ResourceServerReadiness =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Non-throwing readiness check for the x402 paywall.
 *
 * `isOkxBillingEnabled()` only proves four env vars are non-empty — it does not
 * prove the facilitator accepts them. When the credentials are rejected,
 * `initialize()` throws "no supported payment kinds loaded from any
 * facilitator". The paid route previously awaited that with no try/catch, so
 * the throw surfaced as an empty HTTP 500 — which also fails the OKX x402
 * validator, whose check is `POST <endpoint>` → expect 402 + PAYMENT-REQUIRED.
 *
 * Callers must translate `ok: false` into an explicit 503 with a JSON body.
 * Deliberately NOT a self-minted 402: if the facilitator cannot verify a
 * payment, inviting one would take money we cannot settle.
 */
export async function getResourceServerReadiness(): Promise<ResourceServerReadiness> {
  if (!isOkxBillingEnabled()) {
    return { ok: false, error: "OKX billing is not configured" };
  }
  if (initialized) return { ok: true };

  if (
    lastInitFailure &&
    Date.now() - lastInitFailure.at < INIT_FAILURE_TTL_MS
  ) {
    return { ok: false, error: lastInitFailure.error };
  }

  try {
    await ensureOkxResourceServerReady();
    lastInitFailure = null;
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "OKX payment facilitator unavailable";
    lastInitFailure = { at: Date.now(), error: message };

    console.error(
      JSON.stringify({
        level: "error",
        source: "revel",
        scope: "okx_facilitator_unavailable",
        message,
      })
    );

    return { ok: false, error: message };
  }
}

/** True only once the facilitator has actually accepted our credentials. */
export function isOkxBillingOperational(): boolean {
  return initialized;
}

/**
 * JSON 503 for an unreachable payment facilitator.
 * Shaped so an agent can tell "temporarily unavailable" from "unpaid".
 */
export function okxBillingUnavailableBody(error: string) {
  return {
    error: "Payment facilitator unavailable",
    detail: error,
    retryable: true,
    billing: getOkxBillingManifest(),
    hint: "Paid audits are temporarily unavailable. Free website access: /mission-control.",
  };
}

export function getAuditRouteConfig(): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: requirePayout().network,
      payTo: requirePayout().address,
      price: getOkxAuditPriceLabel(),
      maxTimeoutSeconds: 300,
    },
    description:
      "Revel product audit — Reveal Index, Blindspot Map, Blueprint, and Action Queue",
    mimeType: "application/json",
  };
}
