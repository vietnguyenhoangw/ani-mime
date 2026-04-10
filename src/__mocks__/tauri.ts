/**
 * Mock for @tauri-apps/api/core
 *
 * Provides invoke mock with configurable responses, plus convertFileSrc and appDataDir.
 */

const invokeResponses = new Map<string, unknown>();

export const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (invokeResponses.has(cmd)) {
    const response = invokeResponses.get(cmd);
    return typeof response === "function" ? response(args) : response;
  }
  throw new Error(`invoke: unregistered command "${cmd}". Use mockInvoke("${cmd}", response) to register it.`);
});

export function mockInvoke(cmd: string, response: unknown) {
  invokeResponses.set(cmd, response);
}

export function convertFileSrc(path: string): string {
  return `asset://localhost/${path}`;
}

export function resetMocks() {
  invokeResponses.clear();
  invoke.mockClear();
}
