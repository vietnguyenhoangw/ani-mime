import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  availableMonitors,
  LogicalPosition,
  LogicalSize,
  type Monitor,
} from "@tauri-apps/api/window";
import { getDefaultPetSize } from "./useWindowDefaultSize";
import { useSessionList } from "./useSessionList";
import { useLanList } from "./useLanList";
import {
  computeSnap,
  miniBarLength,
  BAR_SHORT,
  type SnapMargins,
  type Orientation,
  type Edge,
  type Rect,
} from "../utils/snap";

export type Mode = "pet" | "mini";

/** Edge gaps for the docked bar: hug the screen edge (2px), but keep enough
 *  top clearance to sit just below the macOS menu bar. */
const MINI_MARGINS: SnapMargins = { edge: 2, menuBar: 28 };

/** Convert a Tauri Monitor (physical px) to a logical-px rect, the same space
 *  as event.screenX/Y and Tauri's LogicalPosition (setPosition). */
function monitorToLogical(m: Monitor): Rect {
  const sf = m.scaleFactor || 1;
  return {
    x: m.position.x / sf,
    y: m.position.y / sf,
    width: m.size.width / sf,
    height: m.size.height / sf,
  };
}

/** The monitor the window is on, as a logical rect (or null). */
async function windowMonitorRect(): Promise<Rect | null> {
  const m = await currentMonitor();
  return m ? monitorToLogical(m) : null;
}

/** All monitors as logical rects (for picking the one under the cursor). */
async function allMonitorRects(): Promise<Rect[]> {
  const ms = await availableMonitors();
  return ms.map(monitorToLogical);
}

/** Pick the monitor rect that contains the point, else the nearest by centre. */
function monitorContaining(x: number, y: number, monitors: Rect[]): Rect | null {
  if (monitors.length === 0) return null;
  for (const m of monitors) {
    if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) return m;
  }
  let best = monitors[0];
  let bestD = Infinity;
  for (const m of monitors) {
    const dx = x - (m.x + m.width / 2);
    const dy = y - (m.y + m.height / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, hi));

/**
 * Dock geometry for a given cursor position on a monitor: the bar is glued to
 * whichever edge the cursor is NEAREST, and slides along that edge centred on
 * the cursor (clamped on-screen). The top edge uses the larger menu-bar margin
 * to clear the macOS menu bar. Pure, so it can be reasoned about easily.
 */
function dockToCursor(
  cursorX: number,
  cursorY: number,
  monitor: Rect,
  barLong: number,
  barShort: number,
  margins: SnapMargins
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
      const monitor = await windowMonitorRect();
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
        MINI_MARGINS
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
  // this window for the whole press) and docks to whichever monitor + edge the
  // cursor is on, sliding along it. rAF-throttled so we don't flood the IPC.
  const startEdgeDrag = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const win = getCurrentWindow();
      const monitors = await allMonitorRects();
      if (monitors.length === 0) return;
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
        const monitor =
          monitorContaining(pending.x, pending.y, monitors) ?? monitors[0];
        const dock = dockToCursor(
          pending.x,
          pending.y,
          monitor,
          barLong,
          barShort,
          MINI_MARGINS
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
