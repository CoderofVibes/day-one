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
        // A tall subject (the attack list) shows its top under the sticky header, not its middle.
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (el.getBoundingClientRect().height > window.innerHeight * 0.5)
          window.scrollTo({ top: Math.max(0, top - 80) });
        else el.scrollIntoView({ block: "center" });
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
