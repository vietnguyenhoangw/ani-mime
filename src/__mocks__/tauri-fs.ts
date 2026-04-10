/**
 * Mock for @tauri-apps/plugin-fs
 */

export const readDir = vi.fn(async () => []);
export const readFile = vi.fn(async () => new Uint8Array());
export const writeFile = vi.fn(async () => {});
export const copyFile = vi.fn(async () => {});
export const exists = vi.fn(async () => false);
export const mkdir = vi.fn(async () => {});
export const remove = vi.fn(async () => {});
export const rename = vi.fn(async () => {});
export const stat = vi.fn(async () => ({ isFile: true, isDirectory: false, size: 0 }));

export const BaseDirectory = {
  AppData: 1,
  AppLocalData: 2,
  Home: 3,
  Desktop: 4,
  Document: 5,
  Download: 6,
  Resource: 7,
  Temp: 8,
};

export function resetMocks() {
  readDir.mockClear();
  readFile.mockClear();
  writeFile.mockClear();
  copyFile.mockClear();
  exists.mockClear();
  mkdir.mockClear();
  remove.mockClear();
  rename.mockClear();
  stat.mockClear();
}
