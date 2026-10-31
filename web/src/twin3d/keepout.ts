// The controls drawn over the 3D stage (the Views pill, the zoom buttons, the layer chips): a
// label that would sit under one fades out, as one crossing the stage edge does. Boxes are in
// canvas pixels, measured off the frame loop.

/** The overlay controls a label keeps clear of. */
export const KEEPOUT_SELECTOR = ".twin-views, .t3-tools, .t3-layers";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A label of `w` × `h` centred at (x, y) that overlaps any box by more than `slack` pixels. */
export function underControl(
  x: number,
  y: number,
  w: number,
  h: number,
  boxes: readonly Box[],
  slack = 2,
): boolean {
  return boxes.some(
    (b) =>
      Math.min(x + w / 2, b.right) - Math.max(x - w / 2, b.left) > slack &&
      Math.min(y + h / 2, b.bottom) - Math.max(y - h / 2, b.top) > slack,
  );
}

/** The visible overlay controls inside `stage`, relative to `canvas`'s top left. */
export function measureKeepout(stage: Element, canvas: Element): Box[] {
  const c = canvas.getBoundingClientRect();
  return [...stage.querySelectorAll(KEEPOUT_SELECTOR)].flatMap((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return [];
    return [
      {
        left: r.left - c.left,
        top: r.top - c.top,
        right: r.right - c.left,
        bottom: r.bottom - c.top,
      },
    ];
  });
}
