import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  availableMonitors,
  LogicalPosition,
  LogicalSize,
  type Monitor,
} from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
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

/** Edge gaps for the docked bar: flush against the screen edge (0px), but keep
 *  enough top clearance to sit just below the macOS menu bar. */
const MINI_MARGINS: SnapMargins = { edge: 0, menuBar: 28 };

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
 * Owns the pet <-> mini transition and the window mechanics.
 *
 * Mini mode behaves like a magnet-docked toolbar: while the grip is held the
 * bar follows the cursor freely (2D), and on release it snaps to the nearest
 * screen edge. At rest it is always docked to an edge. No persistence (the app
 * always launches in pet mode).
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

  // Drag. Started from the grip's mousedown. While the button is held the bar
  // follows the cursor FREELY in 2D (so it goes wherever the pointer goes), and
  // on release it snaps to the nearest edge (snapToNearest). The grab offset is
  // captured so the grabbed point stays under the cursor (no jump on grab), and
  // a plain click never moves the bar. rAF-throttled to avoid flooding the IPC.
  const startEdgeDrag = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const win = getCurrentWindow();
      const monitors = await allMonitorRects();
      if (monitors.length === 0) return;
      const sf = await win.scaleFactor();
      const startPos = (await win.outerPosition()).toLogical(sf);
      const startSize = (await win.outerSize()).toLogical(sf);
      const w = Math.round(startSize.width);
      const h = Math.round(startSize.height);
      // Offset between the window's top-left and the cursor at grab time, so
      // the grabbed point tracks the cursor instead of recentring.
      const offX = startPos.x - e.screenX;
      const offY = startPos.y - e.screenY;

      // Free 2D position for a cursor, clamped to stay on its monitor (and
      // below the menu bar). Keeps the bar's current size during the drag.
      const freePos = (cx: number, cy: number) => {
        const m = monitorContaining(cx, cy, monitors) ?? monitors[0];
        return {
          x: Math.round(clamp(cx + offX, m.x, m.x + m.width - w)),
          y: Math.round(
            clamp(cy + offY, m.y + MINI_MARGINS.menuBar, m.y + m.height - h)
          ),
        };
      };

      let pending: { x: number; y: number } | null = null;
      let raf = 0;

      const apply = () => {
        raf = 0;
        if (!pending) return;
        const p = freePos(pending.x, pending.y);
        void win.setPosition(new LogicalPosition(p.x, p.y)).catch(() => {});
      };

      const onMove = (ev: MouseEvent) => {
        pending = { x: ev.screenX, y: ev.screenY };
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const onUp = async () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (raf) cancelAnimationFrame(raf);
        if (!pending) return; // plain click — never moved
        // Commit the final free position, then snap to the nearest edge.
        const p = freePos(pending.x, pending.y);
        await win.setPosition(new LogicalPosition(p.x, p.y)).catch(() => {});
        void snapToNearest();
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      // No immediate move: a plain click must not move the bar.
    },
    [snapToNearest]
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
    // Make the window non-movable to the OS so macOS Sequoia won't tile it when
    // it reaches a screen edge (we still move it via setPosition).
    void invoke("set_window_movable", { movable: false }).catch(() => {});
    await snapToNearest();
  }, [snapToNearest]);

  const exitMini = useCallback(async () => {
    const win = getCurrentWindow();
    setMode("pet");
    // Restore movability so the native pet drag works again.
    void invoke("set_window_movable", { movable: true }).catch(() => {});
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
