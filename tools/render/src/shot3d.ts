// npm run web:shot:3d -- <out dir> — screenshots the 3D twin (web/src/twin3d) in the built web UI
// at the key demo moments: wide in light mode and phone-width in dark mode, with the curtain
// off and, for the money steps, on. Files are served by request interception, so no server
// runs. Prints console errors, the renderer's draw calls and the frames rendered in one second
// at each moment, and any visible label that crosses the stage edge or overprints another
// (the exit code is 1 when one does). STEPS=all captures every step; CURTAIN=1 keeps the
// curtain on throughout.

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";

const dist = join(import.meta.dirname, "../../../web/dist");
const out = process.argv[2] ?? ".";
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

/** The storyboard's map moments (docs/DEMO_STORYBOARD.md), by the recorded run's step index. */
const KEY: { step: number; name: string; curtain?: boolean }[] = [
  { step: 0, name: "day-one" },
  { step: 2, name: "plant-online" },
  { step: 3, name: "discrepancy" },
  { step: 5, name: "quotes" },
  { step: 7, name: "refused" },
  { step: 7, name: "refused-curtain", curtain: true },
  { step: 9, name: "funded" },
  { step: 10, name: "truck" },
  { step: 11, name: "quarantine" },
  { step: 13, name: "paid" },
  { step: 13, name: "paid-curtain", curtain: true },
  { step: 14, name: "summary" },
];
const run = JSON.parse(readFileSync(join(dist, "../src/data/demo-run.json"), "utf8")) as {
  steps: { title: string }[];
};
const moments =
  process.env.STEPS === "all"
    ? run.steps.map((s, step) => ({ step, name: s.title.toLowerCase().replace(/\W+/g, "-") }))
    : KEY;

// A string, not a function: tsx's esbuild helpers (__name) do not exist in the page.
const PROBE = `new Promise((resolve) => {
  const twin = window.dayOneTwin;
  let frames = 0;
  const start = performance.now();
  const tick = () => {
    frames++;
    if (performance.now() - start < 1000) requestAnimationFrame(tick);
    else resolve({ ...(twin ? twin.info() : { calls: -1, triangles: -1 }), fps: frames });
  };
  requestAnimationFrame(tick);
})`;

/**
 * Visible labels that cross the stage edge, and label pairs that overprint. Labels the view
 * faded out (opacity 0) do not count: that is how the twin keeps a label from being clipped.
 */
const LABELS = `(() => {
  const stage = document.querySelector(".t3-stage").getBoundingClientRect();
  const boxes = [...document.querySelectorAll(".t3-label")]
    .filter((el) => {
      const cs = getComputedStyle(el);
      return cs.display !== "none" && Number(cs.opacity) > 0.5 && el.offsetWidth > 0;
    })
    .map((el) => ({ text: el.textContent.trim().replace(/\\s+/g, " "), r: el.getBoundingClientRect() }));
  const clipped = boxes
    .filter(({ r }) => r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1)
    .map((b) => b.text);
  const overlapping = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // A few pixels of touching corners is not overprinting.
      if (x > 6 && y > 6) overlapping.push(boxes[i].text + " / " + boxes[j].text);
    }
  return { clipped, overlapping };
})()`;

const browser = await chromium.launch({ channel: "msedge" });
let labelProblems = 0;

// RECORD=1: record mode instead (?record=1). The clock must advance by exactly 1000/60 ms per
// frame and the run must reach its last step on its own (research 16).
if (process.env.RECORD) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("http://day-one.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(dist, path === "/" ? "index.html" : path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    route.fulfill({
      body: readFileSync(file),
      contentType: types[extname(file)] ?? "application/octet-stream",
    });
  });
  await page.goto("http://day-one.local/?view=3d&record=1");
  await page.locator(".t3-stage canvas").waitFor();
  const samples: number[] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(700);
    samples.push((await page.evaluate("window.dayOneTwin && window.dayOneTwin.clock")) as number);
  }
  const step = 1000 / 60;
  const fixed = samples.every((s) => Math.abs(s / step - Math.round(s / step)) < 1e-6);
  console.log(
    `record: clock ${samples.map((s) => s.toFixed(2)).join(", ")} ms · every sample a whole number of 1000/60 ms frames: ${fixed}`,
  );
  const counter = page.locator(".step-count");
  console.log(
    `record: after about 4 s the counter reads "${(await counter.textContent())?.trim()}"`,
  );
  await page.waitForFunction(
    `document.querySelector(".step-count")?.textContent?.includes("${run.steps.length} / ${run.steps.length}")`,
    null,
    { timeout: 120_000 },
  );
  console.log(
    `record: reached "${(await counter.textContent())?.trim()}" at clock ${await page.evaluate("window.dayOneTwin.clock")} ms`,
  );
  await page.waitForTimeout(2600);
  await page.locator(".t3-stage").screenshot({ path: join(out, "record-end.png") });
  console.log("record errors:", errors.length ? errors : "none");
  await page.close();
  await browser.close();
  process.exit(fixed && errors.length === 0 ? 0 : 1);
}

for (const [name, width, height, scheme] of [
  ["wide", 1280, 900, "light"],
  ["phone", 390, 844, "dark"],
] as const) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("http://day-one.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(dist, path === "/" ? "index.html" : path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    route.fulfill({
      body: readFileSync(file),
      contentType: types[extname(file)] ?? "application/octet-stream",
    });
  });
  await page.goto("http://day-one.local/?view=3d");
  const stage = page.locator(".t3-stage");
  await stage.locator("canvas").waitFor();
  const curtain = page.getByText("Behind the curtain").first();
  let at = 0;
  let curtainOn = false;
  for (const m of moments) {
    while (at < m.step) {
      await page.keyboard.press("ArrowRight");
      at++;
    }
    const want = Boolean(m.curtain || process.env.CURTAIN);
    if (want !== curtainOn) {
      await curtain.click();
      curtainOn = want;
    }
    await page.waitForTimeout(2600);
    const stats = (await page.evaluate(PROBE)) as { calls: number; triangles: number; fps: number };
    const labels = (await page.evaluate(LABELS)) as { clipped: string[]; overlapping: string[] };
    const file = `${name}-${String(m.step).padStart(2, "0")}-${m.name}.png`;
    await stage.screenshot({ path: join(out, file) });
    console.log(
      `${file}: ${run.steps[m.step]?.title} · ${stats.calls} draw calls, ${stats.triangles} triangles, ${stats.fps} frames in 1 s`,
    );
    for (const text of labels.clipped) console.log(`  clipped at the edge: ${text}`);
    for (const pair of labels.overlapping) console.log(`  overprinting: ${pair}`);
    labelProblems += labels.clipped.length + labels.overlapping.length;
  }
  console.log(name, "errors:", errors.length ? errors : "none");
  await page.close();
}
await browser.close();
console.log(`label problems: ${labelProblems}`);
process.exit(labelProblems === 0 ? 0 : 1);
