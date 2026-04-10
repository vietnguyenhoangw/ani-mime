import { vi } from "vitest";

export const trace = vi.fn(async (_msg: string) => {});
export const debug = vi.fn(async (_msg: string) => {});
export const info = vi.fn(async (_msg: string) => {});
export const warn = vi.fn(async (_msg: string) => {});
export const error = vi.fn(async (_msg: string) => {});
export const attachConsole = vi.fn(async () => () => {});

export function resetMocks() {
  trace.mockClear();
  debug.mockClear();
  info.mockClear();
  warn.mockClear();
  error.mockClear();
  attachConsole.mockClear();
}
