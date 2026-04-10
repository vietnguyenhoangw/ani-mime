import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__mocks__/setup.ts"],
    alias: {
      "@tauri-apps/api/core": resolve(__dirname, "./src/__mocks__/tauri.ts"),
      "@tauri-apps/api/event": resolve(
        __dirname,
        "./src/__mocks__/tauri-event.ts"
      ),
      "@tauri-apps/api/menu": resolve(
        __dirname,
        "./src/__mocks__/tauri-menu.ts"
      ),
      "@tauri-apps/api/window": resolve(
        __dirname,
        "./src/__mocks__/tauri-window.ts"
      ),
      "@tauri-apps/plugin-store": resolve(
        __dirname,
        "./src/__mocks__/tauri-store.ts"
      ),
      "@tauri-apps/plugin-fs": resolve(
        __dirname,
        "./src/__mocks__/tauri-fs.ts"
      ),
      "@tauri-apps/plugin-dialog": resolve(
        __dirname,
        "./src/__mocks__/tauri-dialog.ts"
      ),
      "@tauri-apps/plugin-opener": resolve(
        __dirname,
        "./src/__mocks__/tauri-opener.ts"
      ),
      "@tauri-apps/api/path": resolve(
        __dirname,
        "./src/__mocks__/tauri-path.ts"
      ),
      "@tauri-apps/api/dpi": resolve(
        __dirname,
        "./src/__mocks__/tauri-dpi.ts"
      ),
      "@tauri-apps/plugin-log": resolve(
        __dirname,
        "./src/__mocks__/tauri-log.ts"
      ),
    },
    exclude: ["e2e/**", "node_modules/**"],
  },
});
