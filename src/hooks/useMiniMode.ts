import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { getDefaultPetSize } from "./useWindowDefaultSize";
import { useSessionList } from "./useSessionList";
import { useLanList } from "./useLanList";
import {
  computeSnap,
  miniBarLength,
  BAR_SHORT,
  DEFAULT_MARGINS,
  type Orientation,
  type Edge,
  type Rect,
} from "../utils/snap";

export type Mode = "pet" | "mini";

/** Read the current monitor as a logical-pixel rect, or null if unavailable. */
async function monitorLogicalRect(): Promise<Rect | null> {
  const m = await currentMonitor();
  if (!m) return null;
  const sf = m.scaleFactor || 1;
  return {
    x: m.position.x / sf,
    y: m.position.y / sf,
    width: m.size.width / sf,
    height: m.size.height / sf,
  };
}

/** Magnet glide duration when the bar is released near an edge. */
const MAGNET_DURATION_MS = 220;

/** Ease-out: quick pull, then settle gently onto the edge. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type TauriWindow = ReturnType<typeof getCurrentWindow>;

/**
 * Glide the window from (fromX,fromY) to (toX,toY) over MAGNET_DURATION_MS
 * using an ease-out curve, so releasing the bar feels like it's magnetically
 * inhaled to the nearest edge. Falls back to an instant move when there's no
 * distance to cover or the user prefers reduced motion.
 */
async function animateWindowTo(
  win: TauriWindow,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Promise<void> {
  if ((fromX === toX && fromY === toY) || prefersReducedMotion()) {
    await win.setPosition(new LogicalPosition(toX, toY)).catch(() => {});
    return;
  }
  await new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MAGNET_DURATION_MS);
      const e = easeOutCubic(t);
      const x = Math.round(fromX + (toX - fromX) * e);
      const y = Math.round(fromY + (toY - fromY) * e);
      void win.setPosition(new LogicalPosition(x, y)).catch(() => {});
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Owns the pet <-> mini transition and the window resize/snap mechanics.
 * No persistence (the app always launches in pet mode).
 */
export function useMiniMode(scale: number) {
  const [mode, setMode] = useState<Mode>("pet");
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [edge, setEdge] = useState<Edge>("bottom");
  const savedPetPosRef = useRef<LogicalPosition | null>(null);

  // Size the bar to hug its content. miniBarLength already includes the
  // leading dot and trailing grip; here we count only the 20px action
  // buttons (restore + whichever tools are enabled).
  const { enabled: sessionListEnabled } = useSessionList();
  const { enabled: lanListEnabled } = useLanList();
  const actionButtons =
    1 /* restore */ + (sessionListEnabled ? 1 : 0) + (lanListEnabled ? 1 : 0);
  const barLongLogical = miniBarLength(actionButtons);

  // Compute the nearest-edge snap and apply it. When `animate` is true the
  // window glides to the edge (magnet effect); otherwise it moves instantly
  // (used on enter, panel close, and tool-count re-fit).
  const applySnap = useCallback(
    async (animate: boolean) => {
      const win = getCurrentWindow();
      try {
        const monitor = await monitorLogicalRect();
        if (!monitor) {
          console.warn("[mini-bar] no monitor; leaving bar where dropped");
          return;
        }
        const sf = await win.scaleFactor();
        const pos = (await win.outerPosition()).toLogical(sf);
        const size = (await win.outerSize()).toLogical(sf);
        const barLong = Math.round(barLongLogical * scale);
        const barShort = Math.round(BAR_SHORT * scale);
        const snap = computeSnap(
          { x: pos.x, y: pos.y, width: size.width, height: size.height },
          monitor,
          barLong,
          barShort,
          DEFAULT_MARGINS
        );
        setOrientation(snap.orientation);
        setEdge(snap.edge);
        await win.setSize(new LogicalSize(snap.width, snap.height));
        if (animate) {
          await animateWindowTo(
            win,
            Math.round(pos.x),
            Math.round(pos.y),
            snap.x,
            snap.y
          );
        } else {
          await win.setPosition(new LogicalPosition(snap.x, snap.y));
        }
      } catch (err) {
        console.error("[mini-bar] snap failed:", err);
      }
    },
    [scale, barLongLogical]
  );

  const snapToNearest = useCallback(() => applySnap(false), [applySnap]);
  /** Animated snap — used on drag release for the magnet "inhale" feel. */
  const magnetToNearest = useCallback(() => applySnap(true), [applySnap]);

  // Re-fit the bar when the visible-tool count changes (a tool toggled in
  // Settings while minimized) so the bar always hugs its content.
  useEffect(() => {
    if (mode === "mini") void snapToNearest();
  }, [barLongLogical, mode, snapToNearest]);

  const enterMini = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      const sf = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(sf);
      savedPetPosRef.current = new LogicalPosition(
        Math.round(pos.x),
        Math.round(pos.y)
      );
    } catch (err) {
      console.error("[mini-bar] capture pet position failed:", err);
    }
    setMode("mini");
    await snapToNearest();
  }, [snapToNearest]);

  const exitMini = useCallback(async () => {
    const win = getCurrentWindow();
    setMode("pet");
    try {
      const def = getDefaultPetSize(scale);
      await win.setSize(new LogicalSize(def.width, def.height));
      const saved = savedPetPosRef.current;
      if (saved) await win.setPosition(saved);
      savedPetPosRef.current = null;
    } catch (err) {
      console.error("[mini-bar] restore failed:", err);
    }
  }, [scale]);

  return { mode, orientation, edge, enterMini, exitMini, snapToNearest, magnetToNearest };
}
