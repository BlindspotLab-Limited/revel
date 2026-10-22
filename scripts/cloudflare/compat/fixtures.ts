/**
 * Fixtures for the workerd compatibility probe, produced by plain Node.js —
 * the same code path that wrote today's production data.
 * Run by scripts/cloudflare/test-runtime.mjs; prints JSON on stdout.
 */
import bcrypt from "bcryptjs";
import { encryptSecret } from "@/lib/crypto-secret";
import { createOAuthState } from "@/lib/integrations/oauth-state";
import { hashPartnerApiKey } from "@/lib/partner-keys";
import { hashToken } from "@/lib/user-profile";

process.env.INTEGRATIONS_ENCRYPTION_KEY = "compat-test-key";

const plaintext = "lin_oauth_access_token_example_1234567890";
const password = "Correct-Horse-Battery-Staple-1!";
const partnerKey = "rvl_pk_example_partner_key_value";
const resetToken = "reset-token-example";

console.log(
  JSON.stringify({
    plaintext,
    encrypted: encryptSecret(plaintext),
    oauthState: createOAuthState("user-123", "notion"),
    password,
    passwordHash: bcrypt.hashSync(password, 10),
    partnerKey,
    partnerKeyHash: hashPartnerApiKey(partnerKey),
    resetToken,
    resetTokenHash: hashToken(resetToken),
  })
);
