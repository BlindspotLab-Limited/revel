/**
 * Short-lived HMAC tokens for the internal audit-run endpoint.
 *
 * The Cloudflare Workflow (cloudflare/audit-workflow.ts) runs each audit by
 * calling back into this same Worker through the WORKER_SELF_REFERENCE
 * service binding. That endpoint is reachable from the internet like any
 * other route, so every call carries a token bound to the analysis id, the
 * operation and an expiry, signed with a key derived from AUTH_SECRET.
 *
 * Deliberately dependency-free (WebCrypto only): it is imported both by the
 * Next.js app and by the standalone Workflow entry bundled by Wrangler.
 */

export type AuditRunOperation = "run" | "fail";

export const AUDIT_RUN_TOKEN_HEADER = "x-revel-audit-token";

/** Long enough for a full run plus Workflow retry delays. */
const TOKEN_TTL_SECONDS = 30 * 60;

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    // Domain-separated from every other use of AUTH_SECRET (JWT signing etc.).
    encoder.encode(`revel/audit-run/v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function payload(analysisId: string, op: AuditRunOperation, expires: number) {
  return encoder.encode(`audit-run|v1|${analysisId}|${op}|${expires}`);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function signAuditRunToken(
  secret: string,
  analysisId: string,
  op: AuditRunOperation,
  now = Date.now()
): Promise<string> {
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    payload(analysisId, op, expires)
  );
  return `v1.${expires}.${toHex(signature)}`;
}

export async function verifyAuditRunToken(
  secret: string,
  token: string | null,
  analysisId: string,
  op: AuditRunOperation,
  now = Date.now()
): Promise<boolean> {
  if (!secret || !token) return false;

  const [version, expiresRaw, signatureHex] = token.split(".");
  if (version !== "v1" || !expiresRaw || !signatureHex) return false;

  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || expires < Math.floor(now / 1000)) {
    return false;
  }

  const signature = fromHex(signatureHex);
  if (!signature) return false;

  // crypto.subtle.verify is constant-time with respect to the signature.
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    payload(analysisId, op, expires)
  );
}
