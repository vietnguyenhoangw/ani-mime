import { useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/**
 * Resizes the Tauri window to tightly fit the content element.
 * This keeps the transparent clickable area minimal — the window
 * boundary matches the visible content (sprite + pill + bubble etc.)
 */
export function useWindowAutoSize(
  contentRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const win = getCurrentWindow();

    const updateSize = () => {
      const el = contentRef.current;
      if (!el) return;

      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width === 0 || height === 0) return;

      console.log("[autosize] container:", width, "x", height);
      win.setSize(new LogicalSize(width, height));
    };

    const resizeObs = new ResizeObserver(updateSize);
    resizeObs.observe(el);

    // Watch for child changes (speech bubble, visitors appearing/disappearing)
    const mutationObs = new MutationObserver(updateSize);
    mutationObs.observe(el, { childList: true, subtree: true });

    updateSize();

    return () => {
      resizeObs.disconnect();
      mutationObs.disconnect();
    };
  }, [contentRef]);
}
