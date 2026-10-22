import type { ActivitySource } from "@/lib/activity-context";
import { runWithActivityContext } from "@/lib/activity-context";
import { createRevelMcpServer } from "@/lib/mcp/create-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * Stateless Streamable HTTP handler for Next.js (Cloudflare Workers / Node).
 * Creates a fresh transport + server per request (serverless-safe).
 */
export async function handleMcpHttpRequest(
  request: Request,
  options?: { source?: ActivitySource; paid?: boolean }
): Promise<Response> {
  const run = async () => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = createRevelMcpServer();
  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
  };

  if (options?.source) {
    return runWithActivityContext(
      { source: options.source, paid: options.paid },
      run
    );
  }

  return run();
}