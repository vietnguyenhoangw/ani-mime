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

/**
 * Owns the pet <-> mini transition and the window resize/snap mechanics.
 * No persistence (the app always launches in pet mode).
 */
export function useMiniMode(scale: number) {
  const [mode, setMode] = useState<Mode>("pet");
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [edge, setEdge] = useState<Edge>("bottom");
  const savedPetPosRef = useRef<LogicalPosition | null>(null);

  // Size the bar to hug its content: dot + restore + grip handle + whichever
  // tools are enabled (must match which elements MiniBar actually renders).
  const { enabled: sessionListEnabled } = useSessionList();
  const { enabled: lanListEnabled } = useLanList();
  const barButtons =
    2 /* restore + grip */ +
    (sessionListEnabled ? 1 : 0) +
    (lanListEnabled ? 1 : 0);
  const barLongLogical = miniBarLength(barButtons);

  const snapToNearest = useCallback(async () => {
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
      await win.setPosition(new LogicalPosition(snap.x, snap.y));
    } catch (err) {
      console.error("[mini-bar] snap failed:", err);
    }
  }, [scale, barLongLogical]);

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

  return { mode, orientation, edge, enterMini, exitMini, snapToNearest };
}
