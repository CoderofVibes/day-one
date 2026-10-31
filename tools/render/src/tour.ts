// npm run web:tour -- [out dir] — the tour's end-to-end check (brief §4.10): plays the built UI's
// tour (npm run web:build) at 10x speed (?video=1&tour=1&autostart=1&speed=10) in the installed
// Edge at 1920x1080, every request outside the built files refused, and checks that each beat of
// web/src/video.ts TOUR_BEATS came on screen with each of its captions, in order, and that the
// page logged no errors and asked for nothing on the network. TAKE=1 plays the video take
// (?video=1) instead. With an out dir it also saves the first frame of every beat, one by one.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { BEATS, TOUR_BEATS } from "../../../web/src/video.ts";

const dist = join(import.meta.dirname, "../../../web/dist");
const out = process.argv[2];
const take = process.env.TAKE === "1";
const beats = take ? BEATS : TOUR_BEATS;
const base = take ? "?video=1" : "?video=1&tour=1";
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const browser = await chromium.launch({ channel: "msedge" });
const errors: string[] = [];
const outside: string[] = [];

async function open(query: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.host !== "day-one.local") {
      outside.push(url.href);
      return route.abort();
    }
    const file = join(dist, url.pathname === "/" ? "index.html" : url.pathname);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    route.fulfill({
      body: readFileSync(file),
      contentType: types[extname(file)] ?? "application/octet-stream",
    });
  });
  // Every beat and caption the page shows, in order, as the DOM changes.
  // A string, not a function: tsx would wrap a function's inner names in a helper the page lacks.
  await page.addInitScript({
    content: `
      const seen = (window.__seen = []);
      const note = () => {
        const beat = document.querySelector(".video")?.dataset.beat ?? "";
        const caption = document.querySelector(".video-caption")?.textContent ?? "";
        const last = seen.at(-1);
        if (beat && (!last || last.beat !== beat || last.caption !== caption)) seen.push({ beat, caption });
      };
      new MutationObserver(note).observe(document, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-beat"],
      });
    `,
  });
  await page.goto(`http://day-one.local/${query}`);
  return page;
}

const started = Date.now();
const page = await open(`${base}&autostart=1&speed=10`);
await page.locator('.video[data-done="1"]').waitFor({ timeout: 120_000 });
const seen = await page.evaluate(
  () => (window as unknown as { __seen: { beat: string; caption: string }[] }).__seen,
);
await page.close();

// Each expected (beat, caption) must appear, in this order.
const missing: string[] = [];
let at = 0;
for (const beat of beats) {
  for (const caption of beat.captions) {
    const i = seen.findIndex((s, n) => n >= at && s.beat === beat.id && s.caption === caption);
    if (i < 0) missing.push(`${beat.id}: "${caption}"`);
    else at = i;
  }
}
const captions = beats.reduce((n, b) => n + b.captions.length, 0);
console.log(
  `${take ? "take" : "tour"} at 10x: ${beats.length} beats, ${captions - missing.length} of ${captions} captions in order, ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
for (const m of missing) console.log(`missing ${m}`);

if (out) {
  mkdirSync(out, { recursive: true });
  for (const [i, beat] of beats.entries()) {
    const shot = await open(`${base}&capture=1&from=${beat.id}`);
    await shot.waitForTimeout(beat.panel === "before" || beat.panel === "title" ? 600 : 2600);
    await shot.screenshot({ path: join(out, `${String(i + 1).padStart(2, "0")}-${beat.id}.png`) });
    await shot.close();
  }
  console.log(`${beats.length} frames in ${out}`);
}
await browser.close();

console.log(
  "errors:",
  errors.length ? errors : "none",
  "· network outside the build:",
  outside.length ? outside : "none",
);
if (missing.length || errors.length || outside.length) process.exitCode = 1;
