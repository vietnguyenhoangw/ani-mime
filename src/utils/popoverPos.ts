import type { Edge, Rect } from "./snap";

export interface Point {
  x: number;
  y: number;
}

/**
 * Top-left position (logical screen px) for a popover that opens *inward*
 * from a snapped mini bar, away from the screen edge it hugs.
 */
export function inwardPopoverPos(
  bar: Rect,
  edge: Edge,
  popoverWidth: number,
  popoverHeight: number,
  gap: number
): Point {
  switch (edge) {
    case "left":
      return { x: Math.round(bar.x + bar.width + gap), y: Math.round(bar.y) };
    case "right":
      return { x: Math.round(bar.x - popoverWidth - gap), y: Math.round(bar.y) };
    case "top":
      return { x: Math.round(bar.x), y: Math.round(bar.y + bar.height + gap) };
    case "bottom":
    default:
      return { x: Math.round(bar.x), y: Math.round(bar.y - popoverHeight - gap) };
  }
}
