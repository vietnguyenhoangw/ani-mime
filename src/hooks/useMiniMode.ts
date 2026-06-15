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

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, hi));

/**
 * Dock geometry for a given cursor position on a monitor: the bar is glued to
 * whichever edge the cursor is NEAREST, and slides along that edge centred on
 * the cursor (clamped on-screen). Pure, so it can be reasoned about easily.
 */
function dockToCursor(
  cursorX: number,
  cursorY: number,
  monitor: Rect,
  barLong: number,
  barShort: number,
  margins = DEFAULT_MARGINS
): { x: number; y: number; width: number; height: number; edge: Edge; orientation: Orientation } {
  const distLeft = cursorX - monitor.x;
  const distRight = monitor.x + monitor.width - cursorX;
  const distTop = cursorY - monitor.y;
  const distBottom = monitor.y + monitor.height - cursorY;
  const min = Math.min(distLeft, distRight, distTop, distBottom);

  let edge: Edge;
  if (min === distLeft) edge = "left";
  else if (min === distRight) edge = "right";
  else if (min === distTop) edge = "top";
  else edge = "bottom";

  const vertical = edge === "left" || edge === "right";
  const width = vertical ? barShort : barLong;
  const height = vertical ? barLong : barShort;

  let x: number;
  let y: number;
  if (vertical) {
    x =
      edge === "left"
        ? monitor.x + margins.edge
        : monitor.x + monitor.width - width - margins.edge;
    y = clamp(
      cursorY - height / 2,
      monitor.y + margins.menuBar,
      monitor.y + monitor.height - height - margins.edge
    );
  } else {
    y =
      edge === "top"
        ? monitor.y + margins.menuBar
        : monitor.y + monitor.height - height - margins.edge;
    x = clamp(
      cursorX - width / 2,
      monitor.x + margins.edge,
      monitor.x + monitor.width - width - margins.edge
    );
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    edge,
    orientation: vertical ? "vertical" : "horizontal",
  };
}

/**
 * Owns the pet <-> mini transition and the window mechanics.
 *
 * Mini mode behaves like an edge-docked toolbar: the bar is always glued to a
 * screen edge. Holding the grip drags it ALONG the nearest edge; pulling the
 * cursor toward a different edge re-docks the bar to that edge. It never floats
 * free. No persistence (the app always launches in pet mode).
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

  // Snap the bar flush to the nearest edge (preserving its along-edge
  // position). Instant — used on enter, panel close, and tool-count re-fit.
  const snapToNearest = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      const monitor = await monitorLogicalRect();
      if (!monitor) {
        console.warn("[mini-bar] no monitor; leaving bar where it is");
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

  // Edge-constrained drag. Started from the grip's mousedown. While the button
  // is held, the bar tracks the global cursor (event.screenX/Y, delivered to
  // this window for the whole press) and docks to the nearest edge, sliding
  // along it. rAF-throttled so we don't flood the window-move IPC.
  const startEdgeDrag = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const win = getCurrentWindow();
      const monitor = await monitorLogicalRect();
      if (!monitor) return;
      const barLong = Math.round(barLongLogical * scale);
      const barShort = Math.round(BAR_SHORT * scale);

      let pending: { x: number; y: number } | null = {
        x: e.screenX,
        y: e.screenY,
      };
      let raf = 0;
      let curW = -1;
      let curH = -1;

      const apply = () => {
        raf = 0;
        if (!pending) return;
        const dock = dockToCursor(
          pending.x,
          pending.y,
          monitor,
          barLong,
          barShort
        );
        setOrientation(dock.orientation);
        setEdge(dock.edge);
        if (dock.width !== curW || dock.height !== curH) {
          curW = dock.width;
          curH = dock.height;
          void win.setSize(new LogicalSize(dock.width, dock.height)).catch(() => {});
        }
        void win.setPosition(new LogicalPosition(dock.x, dock.y)).catch(() => {});
      };

      const onMove = (ev: MouseEvent) => {
        pending = { x: ev.screenX, y: ev.screenY };
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (raf) cancelAnimationFrame(raf);
        apply(); // ensure the final position is committed
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      apply(); // dock immediately on grab
    },
    [scale, barLongLogical]
  );

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

  return {
    mode,
    orientation,
    edge,
    enterMini,
    exitMini,
    snapToNearest,
    startEdgeDrag,
  };
}
