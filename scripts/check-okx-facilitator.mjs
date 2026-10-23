/**
 * Live, read-only check that the configured OKX x402 credentials are accepted
 * by the facilitator, and that the payout network is among the supported kinds.
 *
 * Complements scripts/verify-okx-payment-sdk.mjs, which only checks that the
 * SDK packages are installed. This one proves the credentials actually work —
 * the check that distinguishes "configured" from "healthy".
 *
 * Calls getSupported() only. It never signs, settles or moves funds.
 *
 *   npm run check:okx-facilitator
 */
import { config } from "dotenv";
import { OKXFacilitatorClient } from "@okxweb3/app-x402-core";

config({ path: ".env.local" });

const TIMEOUT_MS = 20_000;

const required = ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"];
const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length > 0) {
  console.error(`RESULT_ERR\nMissing credentials: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY,
  secretKey: process.env.OKX_SECRET_KEY,
  passphrase: process.env.OKX_PASSPHRASE,
  syncSettle: true,
});

const expectedNetwork = process.env.OKX_PAY_NETWORK?.trim() || "eip155:196";

try {
  const supported = await Promise.race([
    client.getSupported(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)
    ),
  ]);

  const kinds = supported?.kinds ?? [];
  const networks = [...new Set(kinds.map((kind) => kind.network))];
  const schemes = [
    ...new Set(
      kinds.filter((kind) => kind.network === expectedNetwork).map((k) => k.scheme)
    ),
  ];

  console.log("RESULT_OK");
  console.log(`credentials: accepted (no 401)`);
  console.log(`networks supported: ${networks.join(", ") || "none"}`);

  if (!networks.includes(expectedNetwork)) {
    console.error(
      `RESULT_ERR\nPayout network ${expectedNetwork} is not supported by the facilitator.`
    );
    process.exit(1);
  }

  console.log(`${expectedNetwork} schemes: ${schemes.join(", ")}`);
} catch (error) {
  console.log("RESULT_ERR");
  console.log(error?.message ?? String(error));
  process.exit(1);
}
