// npm run web:shot -- <out dir> — screenshots the built web UI (npm run web:build) with the
// installed Edge, wide in light mode and phone-width in dark mode, with the curtain on and
// STEPS steps in (default 8). Files are served by request interception, so no server runs.
// With URL=http://localhost:8787/ it opens a running API instead (npm run api) and clicks the
// primary action STEPS times, so the live screens get the same check; PLANTS=1 also opens the
// Plants screen. FULL=1 captures the whole page instead of the first screen.
// FEED=1 opens Kevin's activity (the drawer on a phone) and prints how many elements it holds.
// Prints console errors and whether the page scrolls sideways. QUERY= opens any address (Linda's
// phone, judge mode at a step) and leaves the curtain to the page. PAGE=arena also fires three
// attacks in the attack arena and checks each refusal shown against web/src/data/arena.json.
// QUERY="?" opens the bare address, so a first visit gets Kevin's first-shift introduction;
// WAIT=<ms> sets how long the page settles before the capture (the intro's captions are timed).

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
// QUERY=<search> opens any other address as given (QUERY="?page=approve&po=1042", QUERY="?judge=3").
const query =
  process.env.QUERY ??
  `?page=${process.env.PAGE ?? "overview"}${process.env.VIEW === "3d" ? "&view=3d" : ""}`;
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
  await page.addInitScript((t) => localStorage.setItem("day-one-theme", t), scheme);
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
  if (process.env.CURTAIN !== "0" && !process.env.QUERY) {
    await page.getByText("Behind the curtain").filter({ visible: true }).first().click();
  }
  if (url) {
    // Live: take the primary action STEPS times, waiting for each to land. A person's decision
    // has its buttons on Kevin's desk; Up next keeps the upload and Start over.
    const bar = page.getByRole("region", { name: "Next action" });
    await bar.waitFor();
    for (let i = 0; i < steps; i++) {
      const primary = page
        .locator(
          '.desk .card-actions > button:is([data-action="primary"], [data-action="review"]):not([disabled]), [aria-label="Next action"] button[data-action="primary"]:not([disabled])',
        )
        .first();
      await primary.waitFor({ timeout: 30_000 }).catch(async (e: unknown) => {
        await page.screenshot({ path: join(out, `${name}-failed.png`) });
        console.error(`${name}: action bar reads "${await bar.textContent()}"`);
        throw e;
      });
      const label = await primary.textContent();
      if (label === "Start over") break;
      const review = (await primary.getAttribute("data-action")) === "review";
      await primary.click();
      if (review) await page.locator('dialog[open] button[data-action="confirm-reading"]').click();
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
    // The arrows step the run on the Overview and the map only. Each press waits for the step
    // to land: a press before React has re-rendered steps from the same place and is lost.
    const panel = page.locator('[aria-label="Demo steps"]');
    const stepping = await panel.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    );
    for (let i = 0; stepping && i < steps; i++) {
      const was = await panel
        .locator(".step-count")
        .textContent({ timeout: 1_000 })
        .catch(() => null);
      // "15 / 15 · Summary": the run's last step.
      if (was === null || /^(\d+) \/ \1 /.test(was)) break;
      await page.keyboard.press("ArrowRight");
      const moved = await page
        .waitForFunction(
          (w) => document.querySelector('[aria-label="Demo steps"] .step-count')?.textContent !== w,
          was,
          { timeout: 5_000 },
        )
        .then(
          () => true,
          () => false,
        );
      // Kevin's introduction and walkthrough hold the arrows; the shot is taken where it stands.
      if (!moved) {
        console.error(`${name}: the run did not step past "${was}"`);
        break;
      }
    }
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
  const threeD =
    process.env.VIEW === "3d" || (await page.locator(".map-frame:visible").count()) > 0;
  if (threeD) await page.locator(".t3-stage canvas").waitFor();
  await page.waitForTimeout(Number(process.env.WAIT ?? (threeD ? 2400 : 600)));
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
