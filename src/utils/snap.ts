export type Orientation = "horizontal" | "vertical";
export type Edge = "left" | "right" | "top" | "bottom";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapMargins {
  /** Gap from screen edges, in logical px. */
  edge: number;
  /** Extra gap from the top edge to clear the macOS menu bar, in logical px. */
  menuBar: number;
}

export interface SnapResult {
  x: number;
  y: number;
  edge: Edge;
  orientation: Orientation;
  /** Bar window width at this orientation (logical px). */
  width: number;
  /** Bar window height at this orientation (logical px). */
  height: number;
}

/** Bar dimensions in logical px (before display scale). Long = along the edge. */
export const BAR_LONG = 168;
export const BAR_SHORT = 40;

export const DEFAULT_MARGINS: SnapMargins = { edge: 8, menuBar: 30 };

/**
 * Given the current window rect and the monitor rect (both logical px),
 * pick the nearest of the four edges, then the nearest corner on that edge,
 * and return the snapped top-left position + the bar orientation/size.
 *
 * Pure: no Tauri calls, plain numbers in and out, so it is unit-testable.
 */
export function computeSnap(
  win: Rect,
  monitor: Rect,
  barLong: number,
  barShort: number,
  margins: SnapMargins = DEFAULT_MARGINS
): SnapResult {
  const cx = win.x + win.width / 2;
  const cy = win.y + win.height / 2;

  const distLeft = cx - monitor.x;
  const distRight = monitor.x + monitor.width - cx;
  const distTop = cy - monitor.y;
  const distBottom = monitor.y + monitor.height - cy;

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
    const topHalf = cy < monitor.y + monitor.height / 2;
    y = topHalf
      ? monitor.y + margins.menuBar
      : monitor.y + monitor.height - height - margins.edge;
  } else {
    y =
      edge === "top"
        ? monitor.y + margins.menuBar
        : monitor.y + monitor.height - height - margins.edge;
    const leftHalf = cx < monitor.x + monitor.width / 2;
    x = leftHalf
      ? monitor.x + margins.edge
      : monitor.x + monitor.width - width - margins.edge;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    edge,
    orientation: vertical ? "vertical" : "horizontal",
    width,
    height,
  };
}
