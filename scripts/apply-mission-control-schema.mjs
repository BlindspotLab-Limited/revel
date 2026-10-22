/**
 * Applies Mission Control tables when `prisma migrate deploy` cannot reach :5432 locally.
 *
 * Usage: npm run db:schema
 */

import { config } from "dotenv";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: ".env.local" });

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

const sql = readFileSync("supabase/schema.sql", "utf8");

async function tryApply(connectionString, label) {
  const client = new pg.Client({
    connectionString: resolveDatabaseUrl(connectionString),
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log(`schema_applied: true (${label})`);
    return true;
  } catch (error) {
    console.error(`schema_failed (${label}):`, error.message);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const direct = process.env.DIRECT_URL;
const pooled = process.env.DATABASE_URL;

if (direct && (await tryApply(direct, "DIRECT_URL:5432"))) {
  process.exit(0);
}

if (pooled && (await tryApply(pooled, "DATABASE_URL:6543"))) {
  process.exit(0);
}

console.log(`
Could not reach Supabase Postgres from this network (P1001 is common on Windows).

Apply schema manually:
  1. Open Supabase Dashboard → SQL Editor
  2. Paste contents of supabase/schema.sql
  3. Run

Apply migrations from a network that can reach the DB (or the SQL Editor).
Production never runs migrations automatically.

SQL file: supabase/schema.sql
`);
process.exit(1);