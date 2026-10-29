// A watched folder (research 24 §1): Node's fs.watch for speed, and a poll behind it because
// Windows and network drives drop events. A file is handed over once, when its size and time
// have held still for `stableMs` (a scanner or a copy still writing it is left alone), and
// again only if it changes. Kevin dedupes by content, so a rename or a second copy is harmless.

import { type FSWatcher, mkdirSync, readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";

export interface FolderWatchOptions {
  dir: string;
  /** Called once per settled file, with its full path and name. Errors go to `onError`. */
  onFile: (path: string, name: string) => Promise<unknown> | unknown;
  onError?: (error: unknown, name: string) => void;
  /** How long a file's size and time must hold still. */
  stableMs?: number;
  /** The poll that catches what fs.watch drops. */
  pollMs?: number;
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
  mkdirSync(options.dir, { recursive: true });

  /** Last size and time seen per name, and since when it has held. */
  const seen = new Map<string, { sig: string; since: number }>();
  /** The signature each name was handed over with. */
  const handed = new Map<string, string>();
  const running = new Set<Promise<unknown>>();
  let stopped = false;
  let settle: NodeJS.Timeout | null = null;

  const look = () => {
    if (stopped) return;
    let names: string[];
    try {
      names = readdirSync(options.dir);
    } catch (error) {
      options.onError?.(error, options.dir);
      return;
    }
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

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(options.dir, () => look());
    watcher.on("error", () => {
      watcher?.close();
      watcher = null; // the poll carries on alone
    });
  } catch {
    watcher = null;
  }
  const poll = setInterval(look, pollMs);
  look();

  return {
    async scan() {
      look();
      while (running.size) await Promise.all([...running]);
    },
    stop() {
      stopped = true;
      watcher?.close();
      clearInterval(poll);
      if (settle) clearTimeout(settle);
    },
  };
}
