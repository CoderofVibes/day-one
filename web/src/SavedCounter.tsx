// The header's money counter (docs/UPGRADE_BRIEF.md §2.4 item 8): "$X saved · N×", realized
// savings since Day One for the plant at the clock's time over Kevin's cost so far, from the
// same money.ts tally as the Money page. It pulses when a saving lands as the clock plays and
// opens the Money page. Hidden under 1440 px, where the header is full (header.css).

import { useEffect, useRef, useState } from "react";
import { type Clock, useClock } from "./clock.ts";
import { MINUTE_MS } from "./engine.ts";
import { atOf, tally, usdShort } from "./moneyView.ts";
import type { PlantCode } from "./shell.tsx";

export function SavedCounter({
  clock,
  plant,
  onOpen,
}: {
  clock: Clock;
  plant: PlantCode;
  onOpen: () => void;
}) {
  const minute = useClock(clock, (s) => Math.floor(s.simNow / MINUTE_MS));
  const { paid } = tally(plant, atOf(minute * MINUTE_MS));
  const last = useRef(paid.valueUsdc);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const grew = paid.valueUsdc > last.current;
    last.current = paid.valueUsdc;
    if (!grew) return;
    setLanded(true);
    const id = setTimeout(() => setLanded(false), 1_600);
    return () => clearTimeout(id);
  }, [paid.valueUsdc]);
  const ratio = paid.ratio === null ? null : `${paid.ratio}×`;
  return (
    <button
      type="button"
      className={`gh-saved${landed ? " landed" : ""}`}
      onClick={onOpen}
      title="Realized savings since Day One over Kevin's cost so far (Money page)"
    >
      <span className="num">{usdShort(paid.valueUsdc)}</span> saved
      {ratio && (
        <>
          {" · "}
          <span className="num">{ratio}</span>
        </>
      )}
      <span className="sr-only"> his cost</span>
    </button>
  );
}
