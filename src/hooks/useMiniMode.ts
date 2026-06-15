import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
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
  type SnapMargins,
  type Orientation,
  type Edge,
  type Rect,
} from "../utils/snap";

export type Mode = "pet" | "mini";

/** Gap from the work-area edges (uniform — the work area already excludes the
 *  menu bar and Dock, so no special top margin is needed). */
const WORK_MARGINS: SnapMargins = { edge: 8, menuBar: 8 };

/**
 * The current screen's WORK AREA in CSS pixels — the same unit as
 * `event.screenX/Y` (cursor) and Tauri's `LogicalPosition` (setPosition), so
 * snapping math is consistent end-to-end. `avail*` excludes the macOS menu bar
 * and Dock, so the bar docks against the usable area, not under them.
 */
function screenWorkArea(): Rect {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    x: s.availLeft ?? 0,
    y: s.availTop ?? 0,
    width: s.availWidth,
    height: s.availHeight,
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
  margin: number
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
        ? monitor.x + margin
        : monitor.x + monitor.width - width - margin;
    y = clamp(
      cursorY - height / 2,
      monitor.y + margin,
      monitor.y + monitor.height - height - margin
    );
  } else {
    y =
      edge === "top"
        ? monitor.y + margin
        : monitor.y + monitor.height - height - margin;
    x = clamp(
      cursorX - width / 2,
      monitor.x + margin,
      monitor.x + monitor.width - width - margin
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
      const monitor = screenWorkArea();
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
        WORK_MARGINS
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
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const win = getCurrentWindow();
      const monitor = screenWorkArea();
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
          barShort,
          WORK_MARGINS.edge
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
