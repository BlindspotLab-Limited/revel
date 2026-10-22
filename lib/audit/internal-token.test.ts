import assert from "node:assert/strict";
import {
  signAuditRunToken,
  verifyAuditRunToken,
} from "@/lib/audit/internal-token";
import { parseAuditJob } from "@/lib/audit/job";

const SECRET = "test-secret-value";
const ID = "6f1c2d0e-1111-4111-8111-111111111111";
const OTHER_ID = "6f1c2d0e-2222-4222-8222-222222222222";

async function main() {
  const token = await signAuditRunToken(SECRET, ID, "run");
  assert.match(token, /^v1\.\d+\.[0-9a-f]{64}$/);

  // Valid token for the exact analysis + operation.
  assert.equal(await verifyAuditRunToken(SECRET, token, ID, "run"), true);

  // Bound to the analysis id, the operation and the secret.
  assert.equal(await verifyAuditRunToken(SECRET, token, OTHER_ID, "run"), false);
  assert.equal(await verifyAuditRunToken(SECRET, token, ID, "fail"), false);
  assert.equal(await verifyAuditRunToken("other-secret", token, ID, "run"), false);

  // Missing / malformed / tampered tokens.
  assert.equal(await verifyAuditRunToken(SECRET, null, ID, "run"), false);
  assert.equal(await verifyAuditRunToken("", token, ID, "run"), false);
  assert.equal(await verifyAuditRunToken(SECRET, "v1.abc.def", ID, "run"), false);
  const [v, exp, sig] = token.split(".");
  const flipped = `${v}.${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
  assert.equal(await verifyAuditRunToken(SECRET, flipped, ID, "run"), false);
  const extended = `${v}.${Number(exp) + 3600}.${sig}`;
  assert.equal(await verifyAuditRunToken(SECRET, extended, ID, "run"), false);

  // Expiry: a token issued 31 minutes ago is rejected.
  const old = await signAuditRunToken(SECRET, ID, "run", Date.now() - 31 * 60_000);
  assert.equal(await verifyAuditRunToken(SECRET, old, ID, "run"), false);

  // Job parsing (Workflow params / internal endpoint body are untrusted).
  assert.equal(parseAuditJob(null), null);
  assert.equal(parseAuditJob({ analysisId: "not-a-uuid", website: "https://a.b" }), null);
  assert.equal(parseAuditJob({ analysisId: ID, website: "" }), null);
  assert.deepEqual(
    parseAuditJob({
      analysisId: ID,
      website: "https://example.com/",
      userId: "u1",
      activity: { source: "partner_api", paid: true, userId: null },
    }),
    {
      analysisId: ID,
      website: "https://example.com/",
      userId: "u1",
      activity: { source: "partner_api", userId: null, paid: true },
    }
  );
  // Unknown activity sources are dropped rather than trusted.
  assert.equal(
    parseAuditJob({ analysisId: ID, website: "https://x.y", activity: { source: "evil" } })
      ?.activity,
    undefined
  );

  console.log("internal-token: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
