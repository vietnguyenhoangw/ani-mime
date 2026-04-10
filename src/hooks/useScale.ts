import { useState, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

const STORE_FILE = "settings.json";
const STORE_KEY = "displayScale";

export type DisplayScale = 0.5 | 1 | 1.5 | 2;

const SCALE_PRESETS: DisplayScale[] = [0.5, 1, 1.5, 2];

const WINDOW_SIZES: Record<number, { width: number; height: number }> = {
  0.5: { width: 300, height: 140 },
  1: { width: 500, height: 220 },
  1.5: { width: 400, height: 280 },
  2: { width: 450, height: 350 },
};

function applyScale(scale: number) {
  document.documentElement.style.setProperty("--sprite-scale", String(scale));
}

async function resizeMainWindow(scale: number) {
  const win = getCurrentWindow();
  if (win.label !== "main") return;
  const size = WINDOW_SIZES[scale] ?? WINDOW_SIZES[1];
  await win.setSize(new LogicalSize(size.width, size.height));
}

export function useScale() {
  const [scale, setScaleState] = useState<DisplayScale>(1);

  useLayoutEffect(() => {
    load(STORE_FILE).then((store) => {
      store.get<DisplayScale>(STORE_KEY).then((saved) => {
        const s = SCALE_PRESETS.includes(saved as DisplayScale) ? (saved as DisplayScale) : 1;
        setScaleState(s);
        applyScale(s);
        resizeMainWindow(s);
      });
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<DisplayScale>("scale-changed", (event) => {
      setScaleState(event.payload);
      applyScale(event.payload);
      resizeMainWindow(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setScale = async (next: DisplayScale) => {
    setScaleState(next);
    applyScale(next);
    resizeMainWindow(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("scale-changed", next);
  };

  return { scale, setScale, SCALE_PRESETS };
}
