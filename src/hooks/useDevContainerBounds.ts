import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Session-only dev toggle: when true, the main window draws a red
 * outline around the container's content area (inside the padding that
 * reserves space for the status-pill neon glow) so the developer can
 * see where the actual UI content sits vs. the full window bounds.
 */
export function useDevContainerBounds() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unlisten = listen<boolean>("dev-container-bounds-changed", (e) => {
      setVisible(Boolean(e.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return visible;
}
