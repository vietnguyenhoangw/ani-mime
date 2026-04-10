/**
 * Global Vitest setup
 */
import "@testing-library/jest-dom";

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
