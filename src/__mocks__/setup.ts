/**
 * Global Vitest setup
 */
import "@testing-library/jest-dom";

// jsdom does not implement HTMLMediaElement.play/pause — stub them so
// components that call playAudio() (e.g. StatusPill) don't throw.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  writable: true,
  value: () => undefined,
});

import { resetMocks as resetTauri } from "./tauri";
import { resetMocks as resetEvent } from "./tauri-event";
import { resetMocks as resetMenu } from "./tauri-menu";
import { resetMocks as resetWindow } from "./tauri-window";
import { resetMocks as resetStore } from "./tauri-store";
import { resetMocks as resetFs } from "./tauri-fs";
import { resetMocks as resetDialog } from "./tauri-dialog";
import { resetMocks as resetOpener } from "./tauri-opener";
import { resetMocks as resetPath } from "./tauri-path";
import { resetMocks as resetLog } from "./tauri-log";

beforeEach(() => {
  resetTauri();
  resetEvent();
  resetMenu();
  resetWindow();
  resetStore();
  resetFs();
  resetDialog();
  resetOpener();
  resetPath();
  resetLog();
});
