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

/**
 * Mini-bar layout geometry (logical px, before display scale).
 * These MUST stay in sync with the spacing in `mini-bar.css`
 * (gap, padding) and the `.pill-action-btn` / `.dot` sizes so the
 * window hugs its content exactly.
 */
export const MINI_BAR = {
  dot: 7, // leading status dot (bare, hugs the edge)
  button: 20, // action buttons (session/peer/restore)
  grip: 5, // trailing drag-handle glyph (small, flush, hugs the edge)
  gap: 6,
  padding: 8, // along the long axis, each side
  border: 1, // each side
};

/**
 * Long-axis length (logical px) for a mini bar holding the leading status
 * dot, `actionButtons` 20px buttons, and the trailing grip handle.
 * Layout: [pad][dot](gap[button])×actionButtons(gap[grip])[pad] + borders.
 * Lets the bar hug its content instead of using a fixed width.
 */
export function miniBarLength(actionButtons: number): number {
  const g = MINI_BAR;
  return (
    2 * g.border +
    2 * g.padding +
    g.dot +
    actionButtons * (g.gap + g.button) +
    (g.gap + g.grip)
  );
}

export const DEFAULT_MARGINS: SnapMargins = { edge: 8, menuBar: 30 };

/**
 * Given the current window rect and the monitor rect (both logical px),
 * pick the nearest of the four edges, then the nearest corner on that edge,
 * and return the snapped top-left position + the bar orientation/size.
 *
 * Pure: no Tauri calls, plain numbers in and out, so it is unit-testable.
 * Tie-breaking: when two or more distances are equal, edges are chosen in priority order left > right > top > bottom.
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
