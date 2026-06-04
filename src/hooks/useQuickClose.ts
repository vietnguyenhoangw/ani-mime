import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Close (hide) the current window on Cmd+W (macOS) / Ctrl+W (other).
 *
 * For **dialog windows only** (Settings, Superpower, Peer List, Session List).
 * Do NOT use in the main mascot window — it should never be closed this way.
 * Hides rather than destroys, matching the app's existing close semantics for
 * these reusable windows.
 */
export function useQuickClose() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "w") {
        e.preventDefault();
        getCurrentWindow()
          .hide()
          .catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
