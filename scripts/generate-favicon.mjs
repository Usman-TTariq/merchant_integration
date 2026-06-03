import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "favicon-source.png");
const outDir = path.join(root, "public");

if (!fs.existsSync(src)) {
  console.error("Run scripts/extract-ico.ps1 first to create public/favicon-source.png");
  process.exit(1);
}

async function stripWhite(input) {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (r > 245 && g > 245 && b > 245) pixels[i + 3] = 0;
  }
  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  });
}

async function writePng(size, filename) {
  const base = await stripWhite(sharp(src));
  await base
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, filename));
  console.log("wrote", filename);
}

await writePng(16, "favicon-16.png");
await writePng(32, "favicon-32.png");
await writePng(48, "favicon-48.png");
await writePng(180, "apple-touch-icon.png");

const base = await stripWhite(sharp(src));
await base
  .resize(32, 32, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .toFile(path.join(outDir, "favicon.ico"));

console.log("wrote favicon.ico");
