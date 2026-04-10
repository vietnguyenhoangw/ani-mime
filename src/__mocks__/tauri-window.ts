/**
 * Mock for @tauri-apps/api/window
 */

const mockWindow = {
  label: "main",
  startDragging: vi.fn(async () => {}),
  setPosition: vi.fn(async () => {}),
  outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
  setSize: vi.fn(async () => {}),
};

export function getCurrentWindow() {
  return mockWindow;
}

export function resetMocks() {
  mockWindow.startDragging.mockClear();
  mockWindow.setPosition.mockClear();
  mockWindow.outerPosition.mockClear();
  mockWindow.setSize.mockClear();
}
