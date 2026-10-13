import assert from "node:assert/strict";
import {
  DEFAULT_PAY_ASSET,
  DEFAULT_PAY_NETWORK,
  validatePayoutConfig,
} from "@/lib/billing/payout-config";

/** Re-evaluate validation under a specific env, then restore. */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NEW_PAYOUT = "0xA7a2a00D24982c9eBeB16effFd58cEB5DfC94591";
const OLD_PAYOUT = "0xe4c999064e2dda34bdfa5dda21de781856f9c5d2";

// The replacement receiving address must validate on X Layer.
const valid = withEnv(
  { OKX_PAY_TO: NEW_PAYOUT, OKX_PAY_NETWORK: undefined, OKX_PAY_ASSET: undefined },
  validatePayoutConfig
);
assert.equal(valid.ok, true, valid.ok ? "" : valid.errors.join(" | "));
if (valid.ok) {
  assert.equal(valid.config.address, NEW_PAYOUT);
  assert.equal(valid.config.network, DEFAULT_PAY_NETWORK);
  assert.equal(valid.config.asset, DEFAULT_PAY_ASSET);
  assert.equal(valid.config.assetSymbol, "USDT0");
  assert.equal(valid.config.assetDecimals, 6);
  // The replacement must not silently equal the inaccessible wallet.
  assert.notEqual(
    valid.config.address.toLowerCase(),
    OLD_PAYOUT.toLowerCase()
  );
}

// Unset → billing must not be advertised.
const unset = withEnv({ OKX_PAY_TO: undefined }, validatePayoutConfig);
assert.equal(unset.ok, false);
assert.ok(!unset.ok && unset.errors.some((e) => e.includes("not set")));

// Malformed address.
for (const bad of ["0x123", "not-an-address", NEW_PAYOUT.slice(0, 41)]) {
  const result = withEnv({ OKX_PAY_TO: bad }, validatePayoutConfig);
  assert.equal(result.ok, false, `expected rejection for ${bad}`);
}

// Zero / burn / the payment token's own contract must never be a payee.
for (const forbidden of [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dEaD",
  DEFAULT_PAY_ASSET,
]) {
  const result = withEnv({ OKX_PAY_TO: forbidden }, validatePayoutConfig);
  assert.equal(result.ok, false, `expected rejection for ${forbidden}`);
  assert.ok(
    !result.ok && result.errors.some((e) => e.includes("unrecoverable")),
    `expected unrecoverable-funds error for ${forbidden}`
  );
}

// Bad network id is rejected rather than coerced.
const badNetwork = withEnv(
  { OKX_PAY_TO: NEW_PAYOUT, OKX_PAY_NETWORK: "xlayer" },
  validatePayoutConfig
);
assert.equal(badNetwork.ok, false);
assert.ok(!badNetwork.ok && badNetwork.errors.some((e) => e.includes("CAIP-2")));

// A valid alternate network is accepted.
const altNetwork = withEnv(
  { OKX_PAY_TO: NEW_PAYOUT, OKX_PAY_NETWORK: "eip155:1" },
  validatePayoutConfig
);
assert.equal(altNetwork.ok, true);
if (altNetwork.ok) assert.equal(altNetwork.config.network, "eip155:1");

console.log("payout-config tests passed");
