import type { NextConfig } from "next";

/**
 * Baseline security headers for every response rendered by the app.
 * These used to live in vercel.json; keeping them here makes them
 * host-independent (Cloudflare Workers via OpenNext, `next start`, etc.).
 * Static files served directly by Workers Static Assets get the same
 * headers from public/_headers.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/**
 * Set by scripts/cloudflare/build.mjs. Swaps the Prisma client for the build
 * generated with `runtime = "workerd"` (see prisma/schema.prisma). Node
 * builds and `next dev` keep the default Node.js client.
 */
const isCloudflareBuild = process.env.REVEL_BUILD_TARGET === "cloudflare";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
  },
  allowedDevOrigins: [
    "192.168.0.3",
    "127.0.0.1",
    "localhost",
  ],
  turbopack: {
    root: process.cwd(),
    ...(isCloudflareBuild
      ? {
          resolveAlias: {
            "@/lib/generated/prisma/client":
              "./lib/generated/prisma-workerd/client.ts",
          },
        }
      : {}),
  },
  // `pg` loads its Workers socket implementation through the `workerd`
  // export condition, which Next's file tracing does not follow. Without
  // this the OpenNext bundle cannot resolve `pg-cloudflare`.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pg-cloudflare/**/*"],
  },
  // Turbopack's WASM loader makes file tracing match the whole project, and
  // OpenNext bundles every traced .wasm into the Worker — including the
  // Prisma CLI's engines, PGlite and the query compilers of other databases
  // (~20 MB gzipped, over the Workers size limit). The only WASM the app
  // needs at runtime is the workerd Prisma query compiler (emitted by
  // Turbopack as its own chunk under .next/server) and Next's own compiled
  // WASM, so build-time tooling and the unused Node.js Prisma client are
  // excluded from Cloudflare builds.
  ...(isCloudflareBuild
    ? {
        outputFileTracingExcludes: {
          "/**": [
            "./node_modules/prisma/**",
            "./node_modules/@prisma/dev/**",
            "./node_modules/@electric-sql/**",
            "./node_modules/blake3-wasm/**",
            "./node_modules/@img/**",
            "./node_modules/sharp/**",
            "./lib/generated/prisma/**",
          ],
        },
      }
    : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
