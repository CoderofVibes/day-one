// A size-capped log for a long-running server (npm run api -- --log <file>): lines go to the
// file until it would pass `maxBytes`, then it moves to `<file>.1`, replacing the one before,
// and a new file starts. The two never hold much more than twice the cap. Use it instead of
// redirecting a server's output to a file: a redirect has no limit, and a repeating error once
// filled 92 GB of disk that way (Oct 31).

import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { format } from "node:util";

export const DEFAULT_LOG_BYTES = 5 * 1024 * 1024;

/** Returns a writer that appends text to `path`, rolling it to `<path>.1` at `maxBytes`. */
export function cappedLog(path: string, maxBytes = DEFAULT_LOG_BYTES): (text: string) => void {
  let size = existsSync(path) ? statSync(path).size : 0;
  return (text) => {
    const bytes = Buffer.byteLength(text);
    if (size > 0 && size + bytes > maxBytes) {
      rmSync(`${path}.1`, { force: true });
      renameSync(path, `${path}.1`);
      size = 0;
    }
    appendFileSync(path, text);
    size += bytes;
  };
}

/** Sends console.log, info, warn and error to a capped log instead of the terminal. */
export function logToFile(path: string, maxBytes = DEFAULT_LOG_BYTES) {
  const write = cappedLog(path, maxBytes);
  const line = (...args: unknown[]) => write(`${new Date().toISOString()} ${format(...args)}\n`);
  console.log = line;
  console.info = line;
  console.warn = line;
  console.error = line;
}
