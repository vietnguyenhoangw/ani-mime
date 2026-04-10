/**
 * Mock for @tauri-apps/api/event
 *
 * Stores event handlers so tests can fire events with emitMockEvent().
 */

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Set<Handler>>();

export const listen = vi.fn(
  async (event: string, handler: Handler): Promise<() => void> => {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler);
    return () => {
      handlers.get(event)?.delete(handler);
    };
  }
);

export const emit = vi.fn(async (_event: string, _payload?: unknown) => {});

export function emitMockEvent(event: string, payload: unknown) {
  const eventHandlers = handlers.get(event);
  if (eventHandlers) {
    eventHandlers.forEach((handler) => handler({ payload }));
  }
}

export function resetMocks() {
  handlers.clear();
  listen.mockClear();
  emit.mockClear();
}
