// npm run web:shot -- <out dir> — screenshots the built web UI (npm run web:build) with the
// installed Edge, wide in light mode and phone-width in dark mode, with the curtain on and
// STEPS steps in (default 8). Files are served by request interception, so no server runs.
// Prints console errors and whether the page scrolls sideways.

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";

const dist = join(import.meta.dirname, "../../../web/dist");
const out = process.argv[2] ?? ".";
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
const browser = await chromium.launch({ channel: "msedge" });
for (const [name, width, scheme] of [
  ["wide", 1280, "light"],
  ["phone", 390, "dark"],
] as const) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("http://day-one.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(dist, path === "/" ? "index.html" : path);
    route.fulfill({
      body: readFileSync(file),
      contentType: types[extname(file)] ?? "application/octet-stream",
    });
  });
  await page.goto("http://day-one.local/");
  await page.getByText("Behind the curtain").first().click();
  for (let i = 0; i < Number(process.env.STEPS ?? 8); i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: false });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  console.log(name, "errors:", errors.length ? errors : "none", "horizontal overflow:", overflow);
  await page.close();
}
await browser.close();
