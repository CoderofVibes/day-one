// A screen-space label pinned to a point in the 3D scene: the small part of drei's <Html> the twin
// uses (centered, no transform, no occlusion), with one change. drei unmounts each label's React
// root inside the commit that removes it, which React 19 reports as "synchronously unmount a root
// while React was already rendering", and in a production build as an uncaught removeChild error
// that could leave the twin page blank (first-use review, Nov 5, finding 2). Here the label's root
// is unmounted and its element removed after the commit, on a microtask.

import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, type ReactNode, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type Group, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

const objectPos = new Vector3();
const cameraPos = new Vector3();
const cameraDir = new Vector3();

export interface ScreenLabelProps {
  children?: ReactNode;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  center?: boolean;
  pointerEvents?: React.CSSProperties["pointerEvents"];
  /** Nearest and farthest z-index, as drei's `zIndexRange`. */
  zIndexRange?: [number, number];
}

export const ScreenLabel = forwardRef<HTMLDivElement, ScreenLabelProps>(function ScreenLabel(
  {
    children,
    className,
    style,
    center = false,
    pointerEvents = "auto",
    zIndexRange = [16777271, 0],
  },
  ref,
) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const host = useRef<HTMLDivElement | null>(null);
  const root = useRef<Root | null>(null);
  const group = useRef<Group>(null);
  const last = useRef<[number, number]>([Number.NaN, Number.NaN]);
  const visible = useRef(true);

  useLayoutEffect(() => {
    // A fresh element per mount: StrictMode mounts twice, and the first root is still unmounting.
    const el = document.createElement("div");
    const mine = createRoot(el);
    el.style.cssText = "position:absolute;top:0;left:0;";
    gl.domElement.parentNode?.appendChild(el);
    host.current = el;
    root.current = mine;
    last.current = [Number.NaN, Number.NaN];
    visible.current = true;
    return () => {
      host.current = null;
      root.current = null;
      queueMicrotask(() => {
        mine.unmount();
        el.remove();
      });
    };
  }, [gl]);

  useLayoutEffect(() => {
    root.current?.render(
      <div
        ref={ref}
        className={className}
        style={{
          position: "absolute",
          transform: center ? "translate3d(-50%,-50%,0)" : "none",
          pointerEvents,
          ...style,
        }}
      >
        {children}
      </div>,
    );
  });

  useFrame(() => {
    const g = group.current;
    const el = host.current;
    if (!g || !el) return;
    camera.updateMatrixWorld();
    g.updateWorldMatrix(true, false);
    objectPos.setFromMatrixPosition(g.matrixWorld).project(camera);
    const x = objectPos.x * (size.width / 2) + size.width / 2;
    const y = -(objectPos.y * (size.height / 2)) + size.height / 2;
    if (Math.abs(x - last.current[0]) < 0.001 && Math.abs(y - last.current[1]) < 0.001) return;
    last.current = [x, y];
    objectPos.setFromMatrixPosition(g.matrixWorld);
    cameraPos.setFromMatrixPosition(camera.matrixWorld);
    const behind =
      objectPos.clone().sub(cameraPos).angleTo(camera.getWorldDirection(cameraDir)) > Math.PI / 2;
    if (visible.current === behind) {
      visible.current = !behind;
      el.style.display = behind ? "none" : "block";
    }
    if (camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera) {
      const dist = objectPos.distanceTo(cameraPos);
      const a = (zIndexRange[1] - zIndexRange[0]) / (camera.far - camera.near);
      el.style.zIndex = `${Math.round(a * dist + zIndexRange[1] - a * camera.far)}`;
    }
    el.style.transform = `translate3d(${x}px,${y}px,0)`;
  });

  return <group ref={group} />;
});
