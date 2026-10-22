import { siteConfig, subdomainRedirectsEnabled } from "@/lib/site-config";

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function configuredAuthEnvUrl(): string | undefined {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
}

/** True when Auth.js should use localhost (or another non-production host). */
export function isLocalAuthHost(): boolean {
  if (process.env.NODE_ENV === "development") return true;

  const raw = configuredAuthEnvUrl();
  if (!raw) return false;

  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Pin OAuth to auth.tryrevel.xyz in production only — never override localhost. */
export function shouldPinCanonicalAuthUrl(): boolean {
  return subdomainRedirectsEnabled() && !isLocalAuthHost();
}

/** Canonical auth host for OAuth callbacks — never a platform URL or the request host. */
export function getCanonicalAuthUrl(): string {
  if (shouldPinCanonicalAuthUrl()) {
    return normalizeUrl(siteConfig.authUrl);
  }

  const raw = configuredAuthEnvUrl() ?? siteConfig.authUrl;
  return normalizeUrl(raw);
}

export function getGoogleOAuthCallbackUrl(): string {
  return `${getCanonicalAuthUrl()}/api/auth/callback/google`;
}

/** Pin Auth.js env before handlers initialize so redirect_uri stays on auth.tryrevel.xyz. */
export function pinCanonicalAuthEnv(): string {
  const canonical = getCanonicalAuthUrl();

  if (shouldPinCanonicalAuthUrl()) {
    process.env.AUTH_URL = canonical;
    process.env.NEXTAUTH_URL = canonical;
  }

  return canonical;
}