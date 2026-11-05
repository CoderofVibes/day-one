// The spotlight judge mode and the first shift share (JudgeMode.tsx, FirstShift.tsx): the page
// dimmed with a cut-out round what a step is about, found by selector once it is on screen and
// followed as the page scrolls or resizes.

import { useEffect, useRef, useState } from "react";

/** A dimmed page with a cut-out round the first element matching `selector`, once it is there. */
export function Spotlight({
  selector,
  className = "judge-spot",
}: {
  selector: string;
  /** The cut-out's look: judge mode's dimmer, or the first shift's lighter frame. */
  className?: string;
}) {
  const [box, setBox] = useState<DOMRect | null>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    scrolled.current = false;
    setBox(null);
    const measure = () => {
      const el = [...document.querySelectorAll(selector)].find(
        (e) => (e as HTMLElement).offsetParent !== null,
      );
      if (!el) return setBox(null);
      if (!scrolled.current) {
        scrolled.current = true;
        // Fit the subject into what the guide leaves visible: below the sticky header and, on a
        // phone, above the bottom sheet (judge mode's bar or the first shift's dock), measured as
        // it is now rather than assumed. A subject taller than that shows its top.
        const header = 80;
        const sheet = [...document.querySelectorAll<HTMLElement>(".judge-bar, .fs-dock")]
          .map((s) => s.getBoundingClientRect())
          .find((s) => s.width >= window.innerWidth * 0.9 && s.bottom >= window.innerHeight - 4);
        const bottom = sheet ? sheet.top : window.innerHeight;
        const room = Math.max(120, bottom - header);
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        const offset = r.height > room ? 0 : (room - r.height) / 2;
        window.scrollTo({ top: Math.max(0, top - header - offset) });
      }
      const r = el.getBoundingClientRect();
      setBox((was) =>
        was && was.x === r.x && was.y === r.y && was.width === r.width && was.height === r.height
          ? was
          : r,
      );
    };
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [selector]);
  if (!box) return null;
  const pad = 6;
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        left: box.x - pad,
        top: box.y - pad,
        width: box.width + 2 * pad,
        height: box.height + 2 * pad,
      }}
    />
  );
}
