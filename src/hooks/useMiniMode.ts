import { useCallback, useRef, useState } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { getDefaultPetSize } from "./useWindowDefaultSize";
import {
  computeSnap,
  BAR_LONG,
  BAR_SHORT,
  DEFAULT_MARGINS,
  type Orientation,
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
  const savedPetPosRef = useRef<LogicalPosition | null>(null);

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
      const barLong = Math.round(BAR_LONG * scale);
      const barShort = Math.round(BAR_SHORT * scale);
      const snap = computeSnap(
        { x: pos.x, y: pos.y, width: size.width, height: size.height },
        monitor,
        barLong,
        barShort,
        DEFAULT_MARGINS
      );
      setOrientation(snap.orientation);
      await win.setSize(new LogicalSize(snap.width, snap.height));
      await win.setPosition(new LogicalPosition(snap.x, snap.y));
    } catch (err) {
      console.error("[mini-bar] snap failed:", err);
    }
  }, [scale]);

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

  return { mode, orientation, enterMini, exitMini, snapToNearest };
}
