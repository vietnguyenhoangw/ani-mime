import { vi } from "vitest";

export const appDataDir = vi.fn().mockResolvedValue("/mock/app-data/");
export const appConfigDir = vi.fn().mockResolvedValue("/mock/app-config/");
export const resolve = vi.fn((...parts: string[]) =>
  Promise.resolve(parts.join("/")),
);
export const join = vi.fn((...parts: string[]) =>
  Promise.resolve(parts.join("/")),
);
export const basename = vi.fn((path: string) =>
  Promise.resolve(path.split("/").pop() ?? ""),
);

export function resetMocks() {
  appDataDir.mockClear();
  appConfigDir.mockClear();
  resolve.mockClear();
  join.mockClear();
  basename.mockClear();
}
