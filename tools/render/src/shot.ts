// npm run web:shot -- <out dir> — screenshots the built web UI (npm run web:build) with the
// installed Edge, wide in light mode and phone-width in dark mode, with the curtain on and
// STEPS steps in (default 8). Files are served by request interception, so no server runs.
// With URL=http://localhost:8787/ it opens a running API instead (npm run api) and clicks the
// primary action STEPS times, so the live screens get the same check; PLANTS=1 also opens the
// three-plant view. FULL=1 captures the whole page instead of the first screen.
// Prints console errors and whether the page scrolls sideways.

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";

const dist = join(import.meta.dirname, "../../../web/dist");
const out = process.argv[2] ?? ".";
const url = process.env.URL;
const steps = Number(process.env.STEPS ?? 8);
// VIEW=3d opens the 3D twin (web/src/twin3d) and waits for its transitions to settle.
const query = process.env.VIEW === "3d" ? "?view=3d" : "";
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
  if (url) {
    await page.goto(url + query);
  } else {
    await page.route("http://day-one.local/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = join(dist, path === "/" ? "index.html" : path);
      // A static host has no /api: the probe gets 404 and the UI replays the recorded run.
      if (!existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
      route.fulfill({
        body: readFileSync(file),
        contentType: types[extname(file)] ?? "application/octet-stream",
      });
    });
    await page.goto(`http://day-one.local/${query}`);
  }
  await page.getByText("Behind the curtain").first().click();
  if (url) {
    // Live: start over, then take the primary action STEPS times, waiting for each to land.
    const bar = page.getByRole("region", { name: "Next action" });
    await bar.waitFor();
    const reset = bar.getByRole("button", { name: "Start over" });
    if (await reset.isVisible()) await reset.click();
    for (let i = 0; i < steps; i++) {
      const primary = bar.locator('button[data-action="primary"]:not([disabled])').first();
      await primary.waitFor({ timeout: 30_000 }).catch(async (e: unknown) => {
        await page.screenshot({ path: join(out, `${name}-failed.png`) });
        console.error(`${name}: action bar reads "${await bar.textContent()}"`);
        throw e;
      });
      const label = await primary.textContent();
      if (label === "Start over") break;
      await primary.click();
      await page.waitForFunction(
        (was) =>
          !document.querySelector('button[data-action="primary"][disabled]') &&
          document.querySelector('button[data-action="primary"]')?.textContent !== was,
        label,
        { timeout: 30_000 },
      );
    }
    if (process.env.PLANTS) {
      await page.getByText("Three plants").first().click();
      await page.getByRole("region", { name: "Three plants" }).getByRole("table").first().waitFor();
    }
  } else {
    for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowRight");
  }
  if (query) await page.locator(".t3-stage canvas").waitFor();
  await page.waitForTimeout(query ? 2400 : 600);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: Boolean(process.env.FULL) });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  console.log(name, "errors:", errors.length ? errors : "none", "horizontal overflow:", overflow);
  await page.close();
}
await browser.close();
