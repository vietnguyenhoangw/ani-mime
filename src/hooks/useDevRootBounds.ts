import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Session-only dev toggle: when true, outlines the #root element — the
 * React mount node that always fills the Tauri webview (100% × 100%),
 * so it reveals the full window surface even when the session dropdown
 * temporarily grows the window past the auto-sized container.
 *
 * Auto-synced with dev mode: enabling dev mode turns this on, and
 * disabling dev mode turns it off. The Superpower tool can still
 * individually toggle it via `dev-root-bounds-changed` while dev
 * mode is active.
 */
export function useDevRootBounds() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unlistenOutline = listen<boolean>("dev-root-bounds-changed", (e) => {
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
