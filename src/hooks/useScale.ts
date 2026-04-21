import { useState, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_FILE = "settings.json";
const STORE_KEY = "displayScale";

export type DisplayScale = 0.5 | 1 | 1.5 | 2;

const SCALE_PRESETS: DisplayScale[] = [0.5, 1, 1.5, 2];

function applyScale(scale: number) {
  document.documentElement.style.setProperty("--sprite-scale", String(scale));
}

// Window size is no longer driven from here — useWindowAutoSize watches
// .container and resizes the window to match content (which grows with
// the sprite scale via the CSS --sprite-scale variable). Previously this
// hook set fixed per-scale sizes (scale=1 → 500x220) which fought the
// min-width: 320 baseline and caused the window to snap back to 500
// after any content-driven resize.

export function useScale() {
  const [scale, setScaleState] = useState<DisplayScale>(1);

  useLayoutEffect(() => {
    load(STORE_FILE).then((store) => {
      store.get<DisplayScale>(STORE_KEY).then((saved) => {
        const s = SCALE_PRESETS.includes(saved as DisplayScale) ? (saved as DisplayScale) : 1;
        setScaleState(s);
        applyScale(s);
      });
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<DisplayScale>("scale-changed", (event) => {
      setScaleState(event.payload);
      applyScale(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setScale = async (next: DisplayScale) => {
    setScaleState(next);
    applyScale(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("scale-changed", next);
  };

  return { scale, setScale, SCALE_PRESETS };
}
