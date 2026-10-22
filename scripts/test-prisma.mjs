import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const testPostgres = process.argv.includes("--postgres");

async function testSupabaseJs() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.log("SUPABASE_JS: SKIP (SUPABASE_URL or key not set)");
    return false;
  }

  console.log(`SUPABASE_JS: connecting to ${new URL(url).host} (HTTPS) ...`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.from("analyses").select("id").limit(1);

  if (error) {
    console.log(`SUPABASE_JS: FAIL — ${error.code || error.message}`);
    return false;
  }

  console.log(
    `SUPABASE_JS: OK — analyses table reachable (${data?.length ?? 0} rows sampled)`
  );
  return true;
}

async function runPostgresTests() {
  const pg = await import("pg");

  function resolveDatabaseUrl(url) {
    if (!url) throw new Error("Database URL is not set");
    try {
      new URL(url);
      return url;
    } catch {
      const prefix = "postgresql://";
      const rest = url.slice(prefix.length);
      const hostMarker = rest.search(/@(aws-|db\.)/);
      const credentials = rest.slice(0, hostMarker);
      const hostAndPath = rest.slice(hostMarker + 1);
      const separator = credentials.indexOf(":");
      const user = credentials.slice(0, separator);
      const password = credentials.slice(separator + 1);
      return `${prefix}${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostAndPath}`;
    }
  }

  function hostFromUrl(url) {
    try {
      return new URL(resolveDatabaseUrl(url)).host;
    } catch {
      return "invalid-url";
    }
  }

  async function test(name, url) {
    if (!url) {
      console.log(`${name}: SKIP (not set)`);
      return false;
    }

    console.log(`${name}: connecting to ${hostFromUrl(url)} ...`);

    const client = new pg.default.Client({
      connectionString: resolveDatabaseUrl(url),
      connectionTimeoutMillis: 10000,
    });

    let connected = false;

    try {
      await client.connect();
      connected = true;
      const tables = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('users', 'analyses', 'reports')
        ORDER BY table_name
      `);
      console.log(
        `${name}: OK — tables: ${tables.rows.map((r) => r.table_name).join(", ") || "none"}`
      );
      return true;
    } catch (error) {
      client.connection?.stream?.destroy?.();
      console.log(`${name}: FAIL — ${error.code || error.message}`);
      return false;
    } finally {
      if (connected) {
        await client.end().catch(() => {});
      }
    }
  }

  const directOk = await test("DIRECT", process.env.DIRECT_URL);
  if (!directOk) {
    console.log("POOL: SKIP (Postgres ports unreachable locally)");
    return false;
  }

  return (await test("POOL", process.env.DATABASE_URL)) || directOk;
}

async function main() {
  console.log("Testing database connections...\n");

  const jsOk = await testSupabaseJs();

  if (!testPostgres) {
    console.log("");
    if (jsOk) {
      console.log("Database OK for local dev (Supabase JS over HTTPS).");
      console.log("Prisma runs in production (Cloudflare Hyperdrive). Use --postgres to test direct ports.");
      return 0;
    }

    console.log("Supabase JS failed. Check SUPABASE_URL and keys in .env.local.");
    return 1;
  }

  const postgresOk = await runPostgresTests();

  console.log("");
  if (postgresOk) {
    console.log("Postgres is reachable. Prisma can connect directly.");
    return 0;
  }

  if (jsOk) {
    console.log("Postgres ports blocked locally, but Supabase JS works over HTTPS.");
    console.log("Local dev will use Supabase JS. Prisma activates in production (Cloudflare Hyperdrive).");
    return 0;
  }

  console.log("No database connection worked. Check Supabase dashboard and .env.local.");
  return 1;
}

const code = await main();
process.exitCode = code;