import sharp from "sharp";
import fs from "fs";
import path from "path";

const sessionRoot = path.join(
  process.env.USERPROFILE || "",
  ".grok",
  "sessions"
);

function findLatest(name) {
  const hits = [];
  function walk(dir, depth = 0) {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === name) hits.push(p);
    }
  }
  walk(sessionRoot);
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0];
}

const src = findLatest("1.jpg");
if (!src) {
  console.error("Could not find generated 1.jpg");
  process.exit(1);
}

const out = path.resolve("public/brand/revel-avatar-440.png");
const info = await sharp(src)
  .resize(440, 440, { fit: "cover", position: "centre" })
  .flatten({ background: { r: 247, g: 242, b: 235 } })
  .png({ compressionLevel: 9 })
  .toFile(out);

const meta = await sharp(out).metadata();
console.log(JSON.stringify({ src, out, info, meta }, null, 2));
