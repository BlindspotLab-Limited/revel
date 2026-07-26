import { config } from "dotenv";
import { resolve } from "node:path";
import { getExportCapabilities } from "../lib/mission-control-config";
import { getAnalysis } from "../services/store";
import {
  exportToJson,
  exportToMarkdown,
} from "../services/export-service";
import { PUBLIC_SAMPLE_REPORT_ID } from "../lib/public-sample-report";

config({ path: resolve(process.cwd(), ".env.local") });

const ids = [
  process.argv[2],
  PUBLIC_SAMPLE_REPORT_ID,
  "58b90e5e-172b-4577-a7e1-9cd94da8b3c1",
  "sample",
].filter(Boolean) as string[];

async function main() {
  console.log("capabilities", getExportCapabilities());

  const { getAllAnalysesFromFile } = await import("../services/file-store");
  const local = await getAllAnalysesFromFile();
  console.log(
    "file mirror:",
    local.map((a) => ({ id: a.id, hasReport: Boolean(a.report) }))
  );

  for (const id of [...new Set(ids)]) {
    const analysis = await getAnalysis(id === "sample" ? PUBLIC_SAMPLE_REPORT_ID : id);
    console.log("\n---", id, "---");
    if (!analysis) {
      console.log("analysis: NOT FOUND");
      continue;
    }
    console.log("website:", analysis.website);
    console.log("status:", analysis.status);
    console.log("has report:", Boolean(analysis.report));
    if (analysis.report) {
      const md = exportToMarkdown(analysis.report, analysis.website);
      const json = exportToJson(analysis.report, analysis.website);
      console.log("markdown bytes:", md.length);
      console.log("json bytes:", json.length);
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});