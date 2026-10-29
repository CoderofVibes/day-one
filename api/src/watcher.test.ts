import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FolderWatch, watchFolder } from "./watcher.ts";

let dir: string;
let watch: FolderWatch | null = null;
const handed: { name: string; size: number }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "day-one-inbox-"));
  handed.length = 0;
});
afterEach(() => {
  watch?.stop();
  watch = null;
  rmSync(dir, { recursive: true, force: true });
});

const start = (pollMs = 40) => {
  watch = watchFolder({
    dir,
    stableMs: 150,
    pollMs,
    onFile: (path, name) => {
      handed.push({ name, size: statSync(path).size });
    },
  });
  return watch;
};

/** Waits until `n` files were handed over, or fails after two seconds. */
async function handedCount(n: number) {
  for (let i = 0; i < 80 && handed.length < n; i++) await sleep(25);
  await watch?.scan();
  return handed.length;
}

describe("the watched folder", () => {
  it("hands over a file that is already there, once", async () => {
    writeFileSync(join(dir, "BR-B-1044.jpg"), "scan");
    start();
    expect(await handedCount(1)).toBe(1);
    await sleep(300);
    expect(handed).toEqual([{ name: "BR-B-1044.jpg", size: 4 }]);
  });

  it("waits until a file being written has held its size", async () => {
    start();
    const file = join(dir, "BR-B-1046.jpg");
    writeFileSync(file, "half");
    for (let i = 0; i < 4; i++) {
      await sleep(60);
      appendFileSync(file, "-more");
    }
    expect(handed).toEqual([]);
    expect(await handedCount(1)).toBe(1);
    expect(handed[0]).toEqual({ name: "BR-B-1046.jpg", size: 24 });
  });

  it("hands a file over again only when it changes", async () => {
    start();
    const file = join(dir, "BR-B-1045.jpg");
    writeFileSync(file, "first");
    await handedCount(1);
    writeFileSync(file, "second scan");
    expect(await handedCount(2)).toBe(2);
    expect(handed.map((h) => h.size)).toEqual([5, 11]);
  });

  it("skips copies in progress, hidden files and the folder's notes", async () => {
    for (const name of ["~$scan.jpg", ".DS_Store", "scan.jpg.part", "x.crdownload", "README.md"]) {
      writeFileSync(join(dir, name), "x");
    }
    writeFileSync(join(dir, "empty.jpg"), "");
    start();
    await sleep(400);
    await watch?.scan();
    expect(handed).toEqual([]);
  });

  it("finds new files by the poll alone, as on a network drive", async () => {
    start(30);
    writeFileSync(join(dir, "scan-0001.jpg"), "scan");
    expect(await handedCount(1)).toBe(1);
  });

  it("creates the folder when it does not exist yet", async () => {
    const nested = join(dir, "data/inbox/batch-records");
    watch = watchFolder({ dir: nested, onFile: () => undefined });
    expect(statSync(nested).isDirectory()).toBe(true);
  });
});
