import sharp from "sharp";
import path from "path";

// Exact 440×440, square corners only — Revel peel mark on cream (software/service style).
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="440" viewBox="0 0 440 440">
  <rect width="440" height="440" fill="#F7F2EB"/>
  <!-- Product surface card (square corners — no rounded radii) -->
  <rect x="72" y="72" width="296" height="296" fill="#111111"/>
  <!-- Growth map grid lines -->
  <g stroke="#2A2A2A" stroke-width="2" opacity="0.9">
    <line x1="72" y1="146" x2="368" y2="146"/>
    <line x1="72" y1="220" x2="368" y2="220"/>
    <line x1="72" y1="294" x2="368" y2="294"/>
    <line x1="146" y1="72" x2="146" y2="368"/>
    <line x1="220" y1="72" x2="220" y2="368"/>
    <line x1="294" y1="72" x2="294" y2="368"/>
  </g>
  <!-- Blindspot focus -->
  <circle cx="220" cy="220" r="38" fill="none" stroke="#E07A5F" stroke-width="10"/>
  <circle cx="220" cy="220" r="12" fill="#E07A5F"/>
  <!-- Paper peel (reveal) — top-right square corner -->
  <path d="M260 72 H368 V180 Z" fill="#F7F2EB"/>
  <path d="M260 72 L368 180 L368 72 Z" fill="#E07A5F"/>
  <path d="M260 72 L368 180" stroke="#C96A52" stroke-width="4" stroke-linecap="square"/>
</svg>`;

const out = path.resolve("public/brand/revel-avatar-440.png");
const info = await sharp(Buffer.from(svg))
  .resize(440, 440)
  .flatten({ background: { r: 247, g: 242, b: 235 } })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(out);

const meta = await sharp(out).metadata();
const { data, info: raw } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => {
  const i = (y * raw.width + x) * raw.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
console.log(
  JSON.stringify(
    {
      out,
      info,
      meta,
      corners: {
        tl: px(0, 0),
        tr: px(439, 0),
        bl: px(0, 439),
        br: px(439, 439),
      },
    },
    null,
    2
  )
);
