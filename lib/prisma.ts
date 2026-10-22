import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { resolveDatabaseUrl } from "@/lib/database-url";
import {
  getCloudflareRequestScope,
  isCloudflareWorkersRuntime,
} from "@/lib/runtime/cloudflare";

/**
 * Prisma client for the existing Supabase Postgres.
 *
 * Two runtimes, one database:
 *
 * - Cloudflare Workers (production): connects through the Hyperdrive binding
 *   `HYPERDRIVE`. Workers cannot share sockets between requests, so a client
 *   is created per request (cached for the rest of that request) and its
 *   pool hands each connection out once (`maxUses: 1`). Hyperdrive keeps the
 *   real, warm connection pool next to the database. DATABASE_URL and
 *   DIRECT_URL are NOT needed at runtime on Workers.
 *
 * - Node.js (`next dev`, `next start`, scripts): one process-wide client from
 *   DATABASE_URL / DIRECT_URL, exactly as before. DIRECT_URL also stays the
 *   connection Prisma CLI uses for migrations (prisma.config.ts).
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** One client per Workers request, keyed by that request's ExecutionContext. */
const requestClients = new WeakMap<object, PrismaClient>();

type ConnectionTarget =
  | { kind: "hyperdrive"; connectionString: string }
  | { kind: "url"; connectionString: string };

function getConnectionTarget(): ConnectionTarget | null {
  if (isCloudflareWorkersRuntime()) {
    // Hyperdrive only. There is deliberately no fallback to a raw
    // DATABASE_URL here: production traffic must go through Hyperdrive.
    const hyperdrive = getCloudflareRequestScope()?.env.HYPERDRIVE;
    return hyperdrive?.connectionString
      ? { kind: "hyperdrive", connectionString: hyperdrive.connectionString }
      : null;
  }

  if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) return null;

  // Local dev: session pooler (DIRECT_URL) is more reliable than transaction pooler (6543).
  // Production Node: prefer DATABASE_URL for connection pooling.
  const url =
    process.env.NODE_ENV === "production"
      ? process.env.DATABASE_URL
      : process.env.DIRECT_URL;

  return { kind: "url", connectionString: resolveDatabaseUrl(url) };
}

export function isPrismaEnabled(): boolean {
  if (isCloudflareWorkersRuntime()) {
    return !!getCloudflareRequestScope()?.env.HYPERDRIVE?.connectionString;
  }
  return !!process.env.DATABASE_URL && !!process.env.DIRECT_URL;
}

/** Which connection path is active — for health checks; never the URL itself. */
export function getDatabaseConnectionKind(): "hyperdrive" | "url" | null {
  return getConnectionTarget()?.kind ?? null;
}

function createPrismaClient(target: ConnectionTarget): PrismaClient {
  const adapter =
    target.kind === "hyperdrive"
      ? new PrismaPg({ connectionString: target.connectionString, maxUses: 1 })
      : new PrismaPg({ connectionString: target.connectionString });
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient | null {
  const target = getConnectionTarget();
  if (!target) return null;

  if (target.kind === "hyperdrive") {
    const scope = getCloudflareRequestScope();
    // Always inside a request on Workers; without one, never cache.
    if (!scope) return createPrismaClient(target);

    const key = scope.ctx as object;
    let client = requestClients.get(key);
    if (!client) {
      // `maxUses: 1` closes each socket as soon as its query is released,
      // so nothing outlives the request; the WeakMap entry is collected
      // with the request's ExecutionContext.
      client = createPrismaClient(target);
      requestClients.set(key, client);
    }
    return client;
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient(target);
  }

  return globalForPrisma.prisma;
}
