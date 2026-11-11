// The front door on the Overview (first-use review, Nov 5, findings 1 and 8): one line that says
// what this is (a replay of one recorded week at a fictional plant) and where a newcomer starts,
// with the judge tour and Kevin's introduction one click away. Dismissed once, it stays dismissed
// in this browser. Never on the video page or inside judge mode.

import { useState } from "react";

const KEY = "day-one-start-strip";

function hidden(): boolean {
  if (typeof location === "undefined") return true;
  const q = new URLSearchParams(location.search);
  if (q.has("video") || q.has("judge")) return true;
  try {
    return localStorage.getItem(KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function StartStrip() {
  const [gone, setGone] = useState(hidden);
  if (gone) return null;
  return (
    <aside className="start-strip" aria-label="Where to start">
      <p>
        <b>A replay of one recorded week</b> at Hollow Pine Tablet Co., a fictional plant Acme just
        bought. Every person, price and record is invented; the contract calls are real, on NEAR
        testnet.
      </p>
      <div className="start-actions">
        <a className="btn primary" href="?judge=1">
          Take the three-minute tour
        </a>
        <a className="btn" href="?intro=1">
          Meet Kevin
        </a>
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              localStorage.setItem(KEY, "dismissed");
            } catch {
              // A private window may refuse storage; the strip then comes back next visit.
            }
            setGone(true);
          }}
        >
          Hide this
        </button>
      </div>
    </aside>
  );
}
