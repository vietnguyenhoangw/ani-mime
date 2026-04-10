/**
 * Mock for @tauri-apps/plugin-opener
 */

export const openUrl = vi.fn(async () => {});

export function resetMocks() {
  openUrl.mockClear();
}
