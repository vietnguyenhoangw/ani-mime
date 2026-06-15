import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface UseDragOptions {
  /**
   * When true, a drag only starts if the press began on an element marked
   * with `data-drag-handle` (used by the mini bar's grip). Pressing anywhere
   * else does nothing — the window stays put.
   */
  requireHandle?: boolean;
}

export function useDrag(onDragEnd?: () => void, opts: UseDragOptions = {}) {
  const { requireHandle = false } = opts;
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (requireHandle) {
        // Only the explicit drag handle initiates a move.
        if (!target?.closest("[data-drag-handle]")) return;
      } else {
        // Don't start a window drag when interacting with the pill dropdown.
        // Match by data-testid rather than class name per project conventions.
        if (target?.closest('[data-testid="status-pill-wrap"]')) return;
        // Don't drag when pressing a button (minimize/restore/tools/session).
        if (target?.closest("button")) return;
      }
      setDragging(true);
      await getCurrentWindow().startDragging();
      setDragging(false);
      onDragEnd?.();
    },
    [onDragEnd, requireHandle]
  );

  return { dragging, onMouseDown };
}
