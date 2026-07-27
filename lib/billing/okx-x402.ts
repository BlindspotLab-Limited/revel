import { OKXFacilitatorClient } from "@okxweb3/app-x402-core";
import {
  x402ResourceServer,
  type RouteConfig,
} from "@okxweb3/app-x402-core/server";
import { ExactEvmScheme } from "@okxweb3/app-x402-evm/exact/server";
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
      process.env.OKX_PAY_TO?.trim()
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
  return process.env.OKX_PAY_TO?.trim() || undefined;
}

export function getOkxBillingManifest() {
  const priceUsd = getOkxAuditPriceUsd();
  const mcpEndpoint = `${siteConfig.url}/api/mcp`;
  return {
    protocol: "x402",
    agentPaymentsProtocol: "okx-agent-payments-protocol",
    network: OKX_X402_NETWORK,
    unit: "completed_audit",
    priceUsd,
    priceDisplay: `$${priceUsd.toFixed(2)}`,
    currency: "USDT0",
    tokenAddress: OKX_USDT0_ADDRESS,
    endpoint: mcpEndpoint,
    alternateEndpoint: `${siteConfig.url}/api/audit`,
    enabled: isOkxBillingEnabled(),
    note: "OKX Agent Payments Protocol (x402) on billable MCP tools only (revel_analyze_website*). initialize/tools/list/health/poll/export stay free. One charge per started audit.",
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
  const hasPayTo = Boolean(process.env.OKX_PAY_TO?.trim());
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
      network: OKX_X402_NETWORK,
      payTo: process.env.OKX_PAY_TO!,
      price: getOkxAuditPriceLabel(),
      maxTimeoutSeconds: 300,
    },
    description:
      "Revel A2MCP — one charge per completed website audit (Reveal Index, Blueprint, Action Queue)",
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

export function getAuditRouteConfig(): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: OKX_X402_NETWORK,
      payTo: process.env.OKX_PAY_TO!,
      price: getOkxAuditPriceLabel(),
      maxTimeoutSeconds: 300,
    },
    description:
      "Revel product audit — Reveal Index, Blindspot Map, Blueprint, and Action Queue",
    mimeType: "application/json",
  };
}
