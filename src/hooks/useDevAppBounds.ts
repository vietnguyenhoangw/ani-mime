import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Session-only dev toggle: when true, the main window draws a visible
 * outline + tint so the developer can see the exact bounds of the app
 * area (= the auto-sized Tauri window). Starts off on every launch.
 */
export function useDevAppBounds() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unlisten = listen<boolean>("dev-app-bounds-changed", (e) => {
      setVisible(Boolean(e.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return visible;
}
