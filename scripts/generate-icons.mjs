import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Opaque backgrounds and a central mark keep the icon legible under OS masks.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await mkdir("public/icons", { recursive: true });
  for (const [name, size, scale] of [
    ["pwa-192", 192, 0.85],
    ["pwa-512", 512, 0.85],
    ["maskable-512", 512, 0.65],
    ["apple-touch-icon", 180, 0.85],
  ]) {
    const png = await page.evaluate(
      async ({ size, scale }) => {
        const inset = (48 - 48 * scale) / 2;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48"><rect width="48" height="48" fill="#dcebbb"/><g transform="translate(${inset} ${inset}) scale(${scale})" fill="none" stroke="#284d3c" stroke-linecap="round" stroke-width="4"><path d="m15 15 18 18m-22-14 8-8m10 26 8-8M7 15l8-8m18 34 8-8"/></g></svg>`;
        const img = new Image();
        img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { size, scale },
    );
    await writeFile(`public/icons/${name}.png`, Buffer.from(png, "base64"));
  }
} finally {
  await browser.close();
}
