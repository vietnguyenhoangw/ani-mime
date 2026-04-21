import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Session-only dev toggle: when true, outlines the #root element — the
 * React mount node that always fills the Tauri webview (100% × 100%),
 * so it reveals the full window surface even when the session dropdown
 * temporarily grows the window past the auto-sized container.
 */
export function useDevRootBounds() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unlisten = listen<boolean>("dev-root-bounds-changed", (e) => {
      setVisible(Boolean(e.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return visible;
}
