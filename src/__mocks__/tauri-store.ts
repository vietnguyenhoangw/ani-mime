/**
 * Mock for @tauri-apps/plugin-store
 *
 * Each filename gets a cached mock instance so that multiple `load()` calls
 * (e.g. one on mount, one inside a setter) return the SAME object with shared
 * call-count tracking on `set`, `save`, `get`, and `delete`.
 */

const stores = new Map<string, Map<string, unknown>>();
const mockInstances = new Map<string, ReturnType<typeof createMockStore>>();

function getStoreData(file: string): Map<string, unknown> {
  if (!stores.has(file)) {
    stores.set(file, new Map());
  }
  return stores.get(file)!;
}

function createMockStore(file: string) {
  const data = getStoreData(file);
  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      return data.get(key) as T | undefined;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    save: vi.fn(async () => {}),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
}

export async function load(file: string) {
  if (!mockInstances.has(file)) {
    mockInstances.set(file, createMockStore(file));
  }
  return mockInstances.get(file)!;
}

/** Pre-seed a store value for tests */
export function mockStoreValue(file: string, key: string, value: unknown) {
  getStoreData(file).set(key, value);
}

/** Retrieve the cached mock store instance for a filename (for test assertions) */
export function getMockStore(file: string) {
  return mockInstances.get(file);
}

export function resetMocks() {
  stores.clear();
  mockInstances.clear();
}
