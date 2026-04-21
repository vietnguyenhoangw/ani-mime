import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Session-only dev toggle: when true, the main window draws a red
 * outline around the container's content area (inside the padding that
 * reserves space for the status-pill neon glow) so the developer can
 * see where the actual UI content sits vs. the full window bounds.
 *
 * Auto-synced with dev mode: enabling dev mode turns this on, and
 * disabling dev mode turns it off. The Superpower tool can still
 * individually toggle it via `dev-container-bounds-changed` while
 * dev mode is active.
 */
export function useDevContainerBounds() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unlistenOutline = listen<boolean>("dev-container-bounds-changed", (e) => {
      setVisible(Boolean(e.payload));
    });
    const unlistenDevMode = listen<boolean>("dev-mode-changed", (e) => {
      setVisible(Boolean(e.payload));
    });
    return () => {
      unlistenOutline.then((fn) => fn());
      unlistenDevMode.then((fn) => fn());
    };
  }, []);

  return visible;
}
