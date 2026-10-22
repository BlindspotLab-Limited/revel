/**
 * Workers runtime compatibility probe (run by scripts/cloudflare/test-runtime.mjs).
 *
 * Bundled by Wrangler and executed in workerd with the same compatibility
 * date and flags as production. It exercises the Node.js APIs Revel depends
 * on, using fixtures produced by plain Node.js, so it proves that values
 * written by the current production deployment (encrypted OAuth tokens,
 * OAuth state, password hashes, partner key hashes) stay readable after the
 * move to Workers.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import bcrypt from "bcryptjs";
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret";
import { createOAuthState, parseOAuthState } from "@/lib/integrations/oauth-state";
import { hashPartnerApiKey } from "@/lib/partner-keys";
import { hashToken } from "@/lib/user-profile";
import { runWithActivityContext, getActivityContext } from "@/lib/activity-context";
import { OKXFacilitatorClient } from "@okxweb3/app-x402-core";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

type Fixtures = {
  encrypted: string;
  plaintext: string;
  oauthState: string;
  passwordHash: string;
  password: string;
  partnerKey: string;
  partnerKeyHash: string;
  resetToken: string;
  resetTokenHash: string;
};

export default {
  async fetch(request: Request): Promise<Response> {
    const f = (await request.json()) as Fixtures;
    const results: Record<string, boolean | string> = {};
    const run = async (name: string, fn: () => unknown | Promise<unknown>) => {
      try {
        const value = await fn();
        results[name] = value === true ? true : `unexpected: ${String(value)}`;
      } catch (error) {
        results[name] = `threw: ${error instanceof Error ? error.message : String(error)}`;
      }
    };

    await run("runtime_is_workerd", () => navigator.userAgent === "Cloudflare-Workers");
    await run("process_env_populated", () => process.env.INTEGRATIONS_ENCRYPTION_KEY === "compat-test-key");
    await run("aes_gcm_decrypts_node_ciphertext", () => decryptSecret(f.encrypted) === f.plaintext);
    await run("aes_gcm_roundtrip", () => decryptSecret(encryptSecret("round-trip")) === "round-trip");
    await run("oauth_state_from_node_verifies", () => parseOAuthState(f.oauthState, "notion")?.userId === "user-123");
    await run("oauth_state_roundtrip", () => parseOAuthState(createOAuthState("u2", "linear"), "linear")?.userId === "u2");
    await run("oauth_state_rejects_tamper", () => parseOAuthState(`${f.oauthState}x`, "notion") === null);
    await run("bcrypt_verifies_node_hash", () => bcrypt.compare(f.password, f.passwordHash));
    await run("partner_key_hash_matches_node", () => hashPartnerApiKey(f.partnerKey) === f.partnerKeyHash);
    await run("reset_token_hash_matches_node", () => hashToken(f.resetToken) === f.resetTokenHash);
    await run("async_local_storage_context", async () => {
      const value = await runWithActivityContext({ source: "mcp_okx", paid: true }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getActivityContext()?.source;
      });
      return value === "mcp_okx" && new AsyncLocalStorage().getStore() === undefined;
    });
    await run("okx_facilitator_hmac_headers", () => {
      const client = new OKXFacilitatorClient({ apiKey: "k", secretKey: "s", passphrase: "p" });
      const headers = (client as unknown as {
        createHeaders(m: string, p: string, b?: string): Record<string, string>;
      }).createHeaders("GET", "/api/v6/pay/x402/supported");
      return typeof headers["OK-ACCESS-SIGN"] === "string" && headers["OK-ACCESS-SIGN"].length > 20;
    });
    await run("mcp_web_standard_transport", () => {
      const t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      return typeof t.handleRequest === "function";
    });

    return Response.json(results);
  },
};
