// A watched folder (research 24 §1): Node's fs.watch for speed, and a poll behind it because
// Windows and network drives drop events. A file is handed over once, when its size and time
// have held still for `stableMs` (a scanner or a copy still writing it is left alone), and
// again only if it changes. Kevin dedupes by content, so a rename or a second copy is harmless.
// A folder deleted under a running watch (a worktree removed while its API ran, Oct 31) is
// waited for, not recreated: on Windows fs.watch then fires without end and with no error, so
// the watch is dropped, the poll backs off to `maxPollMs`, and the error is reported once until
// the folder reads again. That loop wrote one line about 150,000 times a second, 92 GB of log.

import { type FSWatcher, mkdirSync, readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";

export interface FolderWatchOptions {
  dir: string;
  /** Called once per settled file, with its full path and name. Errors go to `onError`. */
  onFile: (path: string, name: string) => Promise<unknown> | unknown;
  onError?: (error: unknown, name: string) => void;
  /** Called once when the folder reads again after an error. */
  onRecover?: (dir: string) => void;
  /** How long a file's size and time must hold still. */
  stableMs?: number;
  /** The poll that catches what fs.watch drops. */
  pollMs?: number;
  /** The slowest poll while the folder cannot be read; the wait doubles up to it. */
  maxPollMs?: number;
}

export interface FolderWatch {
  /** Looks at the folder now; resolves when every file handed over so far is handled. */
  scan(): Promise<void>;
  stop(): void;
}

/** Names a scanner or a copy leaves while writing, and the folder's own notes. */
const IGNORED = /^(\.|~\$)|\.(tmp|part|crdownload|partial)$|^readme\.md$/i;

export function watchFolder(options: FolderWatchOptions): FolderWatch {
  const stableMs = options.stableMs ?? 1_000;
  const pollMs = options.pollMs ?? 2_000;
  const maxPollMs = Math.max(pollMs, options.maxPollMs ?? 30_000);
  mkdirSync(options.dir, { recursive: true });

  /** Last size and time seen per name, and since when it has held. */
  const seen = new Map<string, { sig: string; since: number }>();
  /** The signature each name was handed over with. */
  const handed = new Map<string, string>();
  const running = new Set<Promise<unknown>>();
  let stopped = false;
  let settle: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  let poll: NodeJS.Timeout | null = null;
  let wait = pollMs;
  /** The error last reported for the folder, until it reads again. */
  let failing: string | null = null;
  /** fs.watch can fire many times per change; one look covers them all. */
  let queued = false;

  const unwatch = () => {
    watcher?.close();
    watcher = null;
  };
  const queueLook = () => {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      look();
    });
  };
  const rewatch = () => {
    try {
      watcher = watch(options.dir, queueLook);
      watcher.on("error", unwatch); // the poll carries on alone
    } catch {
      watcher = null;
    }
  };

  const look = () => {
    if (stopped) return;
    let names: string[];
    try {
      names = readdirSync(options.dir);
    } catch (error) {
      unwatch();
      wait = Math.min(wait * 2, maxPollMs);
      const code = (error as NodeJS.ErrnoException).code ?? String(error);
      if (code !== failing) {
        failing = code;
        options.onError?.(error, options.dir);
      }
      return;
    }
    if (failing !== null) {
      failing = null;
      wait = pollMs;
      options.onRecover?.(options.dir);
    }
    if (!watcher) rewatch();
    const now = Date.now();
    let unsettled = false;
    for (const name of names) {
      if (IGNORED.test(name)) continue;
      const path = join(options.dir, name);
      let sig: string;
      try {
        const st = statSync(path);
        if (!st.isFile() || st.size === 0) continue;
        sig = `${st.size}:${st.mtimeMs}`;
      } catch {
        continue; // gone between the listing and the look
      }
      if (handed.get(name) === sig) continue;
      const last = seen.get(name);
      if (last?.sig !== sig) {
        seen.set(name, { sig, since: now });
        unsettled = true;
        continue;
      }
      if (now - last.since < stableMs) {
        unsettled = true;
        continue;
      }
      handed.set(name, sig);
      seen.delete(name);
      const job = Promise.resolve()
        .then(() => options.onFile(path, name))
        .catch((error: unknown) => options.onError?.(error, name))
        .finally(() => running.delete(job));
      running.add(job);
    }
    for (const name of seen.keys()) if (!names.includes(name)) seen.delete(name);
    if (unsettled && !settle) {
      settle = setTimeout(() => {
        settle = null;
        look();
      }, stableMs);
    }
  };

  const tick = () => {
    poll = setTimeout(() => {
      look();
      if (!stopped) tick();
    }, wait);
  };
  rewatch();
  tick();
  look();

  return {
    async scan() {
      look();
      while (running.size) await Promise.all([...running]);
    },
    stop() {
      stopped = true;
      unwatch();
      if (poll) clearTimeout(poll);
      if (settle) clearTimeout(settle);
    },
  };
}
