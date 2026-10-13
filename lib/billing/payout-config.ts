/**
 * Single source of truth for where Revel receives payment.
 *
 * Revel only ever RECEIVES. `OKX_PAY_TO` is a plain receiving address: it needs
 * no private key, no seed phrase and no signing authority, and nothing in this
 * codebase signs on its behalf. The OKX_API_KEY / OKX_SECRET_KEY /
 * OKX_PASSPHRASE triple is a facilitator API credential for settlement
 * verification, not a wallet.
 *
 * Validation here is deliberately strict: a malformed, zero, or
 * token-contract address would send real funds somewhere unrecoverable, so an
 * invalid value disables billing rather than being advertised.
 */

/**
 * CAIP-2 network id. The x402 SDK types this as `${string}:${string}`, so the
 * same shape is enforced here instead of casting at the call site.
 */
export type Caip2Network = `${string}:${string}`;

/** X Layer mainnet — the OKX Onchain OS payment network. */
export const DEFAULT_PAY_NETWORK: Caip2Network = "eip155:196";

/** USDT0 on X Layer (6 decimals). This is a TOKEN contract, never a payee. */
export const DEFAULT_PAY_ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Addresses that must never be used as a payee. */
const FORBIDDEN_PAYEES = new Set([
  ZERO_ADDRESS,
  "0x000000000000000000000000000000000000dead",
  DEFAULT_PAY_ASSET,
]);

export interface PayoutConfig {
  address: string;
  network: Caip2Network;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
}

export type PayoutValidation =
  | { ok: true; config: PayoutConfig }
  | { ok: false; errors: string[] };

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** `eip155:<chainId>` per CAIP-2. */
function isCaip2Network(value: string): boolean {
  return /^eip155:\d+$/.test(value);
}

export function getPayoutNetwork(): Caip2Network {
  const raw = process.env.OKX_PAY_NETWORK?.trim();
  // Only a validated value may widen into the SDK's template-literal type.
  return raw && isCaip2Network(raw) ? (raw as Caip2Network) : DEFAULT_PAY_NETWORK;
}

export function getPayoutAsset(): string {
  return process.env.OKX_PAY_ASSET?.trim() || DEFAULT_PAY_ASSET;
}

/**
 * Validate the configured payee without contacting any network.
 * Non-spending by design — format and identity checks only.
 */
export function validatePayoutConfig(): PayoutValidation {
  const errors: string[] = [];

  const address = process.env.OKX_PAY_TO?.trim() ?? "";
  const rawNetwork = process.env.OKX_PAY_NETWORK?.trim() || DEFAULT_PAY_NETWORK;
  const network = getPayoutNetwork();
  const asset = getPayoutAsset();

  if (!address) {
    errors.push("OKX_PAY_TO is not set.");
  } else if (!isEvmAddress(address)) {
    errors.push(
      "OKX_PAY_TO is not a valid EVM address (expected 0x followed by 40 hex characters)."
    );
  } else if (FORBIDDEN_PAYEES.has(address.toLowerCase())) {
    errors.push(
      "OKX_PAY_TO is the zero address, the burn address, or the payment token's own contract — funds sent there are unrecoverable."
    );
  }

  if (!isCaip2Network(rawNetwork)) {
    errors.push(
      `OKX_PAY_NETWORK "${rawNetwork}" is not a CAIP-2 EVM network id (expected eip155:<chainId>).`
    );
  }

  if (!isEvmAddress(asset)) {
    errors.push("OKX_PAY_ASSET is not a valid EVM token contract address.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      address,
      network,
      asset,
      assetSymbol: process.env.OKX_PAY_ASSET_SYMBOL?.trim() || "USDT0",
      assetDecimals: Number(process.env.OKX_PAY_ASSET_DECIMALS ?? "6"),
    },
  };
}

export function isPayoutConfigured(): boolean {
  return validatePayoutConfig().ok;
}

/** Public-safe summary. A receiving address is public by nature. */
export function getPayoutSummary() {
  const result = validatePayoutConfig();

  if (!result.ok) {
    return {
      configured: false,
      network: getPayoutNetwork(),
      asset: getPayoutAsset(),
      errors: result.errors,
    };
  }

  return {
    configured: true,
    address: result.config.address,
    network: result.config.network,
    asset: result.config.asset,
    assetSymbol: result.config.assetSymbol,
    assetDecimals: result.config.assetDecimals,
  };
}
