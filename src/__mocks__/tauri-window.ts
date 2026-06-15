/**
 * Mock for @tauri-apps/api/window
 */

export class LogicalPosition {
  type = "Logical" as const;
  constructor(public x: number, public y: number) {}
}

export class LogicalSize {
  type = "Logical" as const;
  constructor(public width: number, public height: number) {}
}

export class PhysicalPosition {
  type = "Physical" as const;
  constructor(public x: number, public y: number) {}
  toLogical(_sf: number) {
    return new LogicalPosition(this.x, this.y);
  }
}

export class PhysicalSize {
  type = "Physical" as const;
  constructor(public width: number, public height: number) {}
  toLogical(_sf: number) {
    return new LogicalSize(this.width, this.height);
  }
}

const mockWindow = {
  label: "main",
  startDragging: vi.fn(async () => {}),
  setPosition: vi.fn(async () => {}),
  outerPosition: vi.fn(async () => new PhysicalPosition(0, 0)),
  outerSize: vi.fn(async () => new PhysicalSize(160, 240)),
  setSize: vi.fn(async () => {}),
  scaleFactor: vi.fn(async () => 1),
  hide: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
};

export function getCurrentWindow() {
  return mockWindow;
}

export const currentMonitor = vi.fn(async () => ({
  name: "mock",
  scaleFactor: 1,
  position: new PhysicalPosition(0, 0),
  size: new PhysicalSize(1000, 800),
}));

export function resetMocks() {
  mockWindow.startDragging.mockClear();
  mockWindow.setPosition.mockClear();
  mockWindow.outerPosition.mockClear();
  mockWindow.outerSize.mockClear();
  mockWindow.setSize.mockClear();
  mockWindow.scaleFactor.mockClear();
  mockWindow.hide.mockClear();
  mockWindow.close.mockClear();
  currentMonitor.mockClear();
}
