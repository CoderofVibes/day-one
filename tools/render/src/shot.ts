// npm run web:shot -- <out dir> — screenshots the built web UI (npm run web:build) with the
// installed Edge, wide in light mode and phone-width in dark mode, with the curtain on and
// STEPS steps in (default 8). Files are served by request interception, so no server runs.
// With URL=http://localhost:8787/ it opens a running API instead (npm run api) and clicks the
// primary action STEPS times, so the live screens get the same check; PLANTS=1 also opens the
// Plants screen. FULL=1 captures the whole page instead of the first screen.
// FEED=1 opens Kevin's activity (the drawer on a phone) and prints how many elements it holds.
// Prints console errors and whether the page scrolls sideways. PAGE=arena also fires three
// attacks in the attack arena and checks each refusal shown against web/src/data/arena.json.

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";

const dist = join(import.meta.dirname, "../../../web/dist");
const out = process.argv[2] ?? ".";
const url = process.env.URL;
const steps = Number(process.env.STEPS ?? 8);
// A page with the plant map waits for the 3D twin (web/src/twin3d, the only map view since Oct 30)
// and its transitions to settle; VIEW=3d is still accepted.
// The integration program is the home page; the run and its twin are on the Overview, so that
// is where the shots open unless PAGE names another page (PAGE=integration).
const query = `?page=${process.env.PAGE ?? "overview"}${process.env.VIEW === "3d" ? "&view=3d" : ""}`;
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
    // Start the run over before the page opens; a click on the page's "Start over" raced the
    // next primary click, which landed on the old state.
    await page.request.post(new URL("api/run/reset", url).href, { data: {} });
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
  // The trust marker sits in the sidebar on a wide screen and in the top bar on a phone.
  // CURTAIN=0 leaves it off, for the screens staff see.
  if (process.env.CURTAIN !== "0") {
    await page.getByText("Behind the curtain").filter({ visible: true }).first().click();
  }
  if (url) {
    // Live: take the primary action STEPS times, waiting for each to land.
    const bar = page.getByRole("region", { name: "Next action" });
    await bar.waitFor();
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
      // On a phone the page list is behind the menu button.
      const menu = page.getByRole("button", { name: "Pages" });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole("link", { name: "Three plants" }).click();
      await page.getByRole("region", { name: "Three plants" }).getByRole("table").first().waitFor();
    }
  } else {
    for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowRight");
  }
  if (process.env.PAGE === "arena") await fireThree(page, name);
  if (process.env.FEED) {
    // Kevin's activity: a rail beside the Overview from 1280 px, a drawer below it.
    const open = page.getByRole("button", { name: /^Kevin's activity/ }).filter({ visible: true });
    if (await open.count()) {
      await open.first().click();
      await page.waitForTimeout(300);
    }
    const nodes = await page.evaluate(() => document.querySelectorAll(".feed-rail *").length);
    console.log(name, "feed nodes:", nodes);
  }
  const threeD = process.env.VIEW === "3d" || (await page.locator(".map-frame").count()) > 0;
  if (threeD) await page.locator(".t3-stage canvas").waitFor();
  await page.waitForTimeout(threeD ? 2400 : 600);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: Boolean(process.env.FULL) });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  console.log(name, "errors:", errors.length ? errors : "none", "horizontal overflow:", overflow);
  await page.close();
}
await browser.close();

/** The arena's browser check: three attacks fired, each reason as the suite recorded it. */
async function fireThree(page: import("playwright-core").Page, name: string) {
  const arena = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../web/src/data/arena.json"), "utf8"),
  ) as {
    cases: { n: number; attack: string; reason: string; txs: { tx: string; status: string }[] }[];
  };
  const picks = [1, 5, 12].map((n) => arena.cases.find((c) => c.n === n));
  const wrong: string[] = [];
  for (const c of picks) {
    if (!c) continue;
    await page.locator(".arena-list button").filter({ hasText: c.attack }).click();
    await page.getByRole("button", { name: "Fire attack" }).click();
    const result = page.getByRole("region", { name: "Result" });
    await result.waitFor();
    const reason = await result.locator(".arena-reason").textContent();
    if (reason !== c.reason) wrong.push(`${c.attack}: shows "${reason}"`);
    const refused = c.txs.find((t) => t.status === "refused");
    const hash = await result
      .locator("code[title]")
      .getAttribute("title")
      .catch(() => null);
    const text = (await result.textContent()) ?? "";
    if (refused ? hash !== refused.tx : !text.includes("no transaction: refused before the chain"))
      wrong.push(`${c.attack}: transaction shown does not match the recording`);
  }
  const tally = await page.locator(".arena-tally").textContent();
  if (tally !== "Refused 3 of 3 you tried · Suite: 15 of 15") wrong.push(`tally reads "${tally}"`);
  console.log(name, "arena:", wrong.length ? wrong : "3 attacks fired, reasons match the suite");
  if (wrong.length) process.exitCode = 1;
}
