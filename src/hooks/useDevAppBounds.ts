import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Session-only dev toggle: when true, the main window draws a visible
 * outline + tint so the developer can see the exact bounds of the app
 * area (= the auto-sized Tauri window).
 *
 * Auto-synced with dev mode: enabling dev mode turns this on, and
 * disabling dev mode turns it off. The Superpower tool can still
 * individually toggle it via `dev-app-bounds-changed` while dev mode
 * is active.
 */
export function useDevAppBounds() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unlistenOutline = listen<boolean>("dev-app-bounds-changed", (e) => {
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
