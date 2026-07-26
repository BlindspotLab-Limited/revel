import { config } from "dotenv";
import { resolve } from "node:path";
import { getAnalysis } from "../services/store";
import { exportToMarkdown } from "../services/export-service";

config({ path: resolve(process.cwd(), ".env.local") });

const id = process.argv[2] ?? "7953bbc7-3622-4a40-a1fd-ea7c726b2109";

async function main() {
  const analysis = await getAnalysis(id);
  if (!analysis?.report) {
    throw new Error(`No report for ${id}`);
  }

  const content = exportToMarkdown(analysis.report, analysis.website);
  console.log("export ok", {
    id: analysis.id,
    website: analysis.website,
    bytes: content.length,
    preview: content.slice(0, 120).replace(/\n/g, " "),
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});