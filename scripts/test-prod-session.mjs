/**
 * Verifies production auth cookies use Domain=.tryrevel.xyz and work cross-subdomain.
 * Usage: node scripts/test-prod-session.mjs
 */

const authBase = "https://auth.tryrevel.xyz";
const appBase = "https://tryrevel.xyz";

function collectSetCookies(response) {
  const headers = response.headers.getSetCookie?.() ?? [];
  if (headers.length > 0) return headers;

  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookieJar(jar, setCookieHeaders) {
  const map = new Map(
    jar
      .split("; ")
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf("=");
        return [pair.slice(0, idx), pair.slice(idx + 1)];
      })
  );

  for (const header of setCookieHeaders) {
    const [pair] = header.split(";");
    const idx = pair.indexOf("=");
    map.set(pair.slice(0, idx), pair.slice(idx + 1));
  }

  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const email = `prod-session-${Date.now()}@example.com`;
  const password = "prod-session-test-password";

  const signupRes = await fetch(`${authBase}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!signupRes.ok) {
    const body = await signupRes.text();
    throw new Error(`Signup failed (${signupRes.status}): ${body}`);
  }

  let cookieJar = "";

  const csrfRes = await fetch(`${authBase}/api/auth/csrf`);
  const csrfBody = await csrfRes.json();
  cookieJar = mergeCookieJar(cookieJar, collectSetCookies(csrfRes));

  const signInRes = await fetch(`${authBase}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieJar,
    },
    body: new URLSearchParams({
      csrfToken: csrfBody.csrfToken,
      email,
      password,
      callbackUrl: `${appBase}/mission-control`,
    }),
    redirect: "manual",
  });

  const signInCookies = collectSetCookies(signInRes);
  cookieJar = mergeCookieJar(cookieJar, signInCookies);

  const sessionCookie = signInCookies.find((header) =>
    header.startsWith("__Secure-next-auth.session-token=")
  );
  assert(sessionCookie, "Expected __Secure-next-auth.session-token on production");
  assert(
    signInCookies.some((header) => /;\s*Domain=\.tryrevel\.xyz/i.test(header)),
    "Production session cookie must set Domain=.tryrevel.xyz"
  );

  for (const base of [authBase, appBase]) {
    for (const path of ["/mission-control", "/mission-control/account"]) {
      const res = await fetch(`${base}${path}`, {
        headers: { Cookie: cookieJar },
        redirect: "manual",
      });

      const location = res.headers.get("location") ?? "";
      assert(
        res.status !== 307 && res.status !== 302 && !location.includes("/log-in"),
        `${base}${path} redirected to sign-in (${res.status} -> ${location})`
      );
      assert(res.status === 200, `${base}${path} returned ${res.status}, expected 200`);
    }
  }

  const debugRes = await fetch(`${authBase}/api/auth/oauth-debug`);
  const debug = await debugRes.json();

  console.log(
    JSON.stringify(
      {
        ok: true,
        authBase,
        appBase,
        email,
        sessionCookie: sessionCookie.split(";")[0],
        nextauth_url: debug.NEXTAUTH_URL,
        hostsTested: [authBase, appBase],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});