import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useDrag(onDragEnd?: () => void) {
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      // Don't start a window drag when interacting with the pill dropdown.
      // Match by data-testid rather than class name per project conventions.
      if (target?.closest('[data-testid="status-pill-wrap"]')) return;
      // Don't drag when pressing a button (minimize/restore/tools/session).
      if (target?.closest("button")) return;
      setDragging(true);
      await getCurrentWindow().startDragging();
      setDragging(false);
      onDragEnd?.();
    },
    [onDragEnd]
  );

  return { dragging, onMouseDown };
}
