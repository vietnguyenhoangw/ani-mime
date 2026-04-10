/**
 * Mock for @tauri-apps/plugin-dialog
 */

export const open = vi.fn(async () => null);
export const save = vi.fn(async () => null);

export function resetMocks() {
  open.mockClear();
  save.mockClear();
}
