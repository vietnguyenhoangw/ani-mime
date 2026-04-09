import { useState, useLayoutEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Status, CustomMimeData } from "../types/status";

const STORE_FILE = "settings.json";
const STORE_KEY = "customMimes";
const SPRITES_DIR = "custom-sprites";
const ALL_STATUSES: Status[] = [
  "idle",
  "busy",
  "service",
  "disconnected",
  "searching",
  "initializing",
  "visiting",
];

export { ALL_STATUSES };

export function useCustomMimes() {
  const [mimes, setMimes] = useState<CustomMimeData[]>([]);
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    load(STORE_FILE).then(async (store) => {
      const saved = await store.get<CustomMimeData[]>(STORE_KEY);
      setMimes(saved ?? []);
      setLoaded(true);
    });
  }, []);

  useLayoutEffect(() => {
    const unlisten = listen<CustomMimeData[]>(
      "custom-mimes-changed",
      (event) => {
        setMimes(event.payload);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const saveMimes = useCallback(async (next: CustomMimeData[]) => {
    setMimes(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("custom-mimes-changed", next);
  }, []);

  const ensureSpritesDir = useCallback(async () => {
    const base = await appDataDir();
    const dir = `${base}${SPRITES_DIR}`;
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    return dir;
  }, []);

  const pickSpriteFile = useCallback(async (): Promise<string | null> => {
    const result = await open({
      multiple: false,
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    });
    return result ?? null;
  }, []);

  const addMime = useCallback(
    async (
      name: string,
      spriteFiles: Record<Status, { sourcePath: string; frames: number }>
    ) => {
      const id = `custom-${Date.now()}`;
      const dir = await ensureSpritesDir();

      const sprites: Record<string, { fileName: string; frames: number }> = {};
      for (const status of ALL_STATUSES) {
        const { sourcePath, frames } = spriteFiles[status];
        const ext = sourcePath.split(".").pop() ?? "png";
        const fileName = `${id}-${status}.${ext}`;
        const destPath = `${dir}/${fileName}`;
        await copyFile(sourcePath, destPath);
        sprites[status] = { fileName, frames };
      }

      const newMime: CustomMimeData = {
        id,
        name,
        sprites: sprites as Record<
          Status,
          { fileName: string; frames: number }
        >,
      };

      await saveMimes([...mimes, newMime]);
      return id;
    },
    [mimes, saveMimes, ensureSpritesDir]
  );

  const deleteMime = useCallback(
    async (id: string) => {
      const mime = mimes.find((m) => m.id === id);
      if (!mime) return;

      const dir = await ensureSpritesDir();
      for (const status of ALL_STATUSES) {
        const fileName = mime.sprites[status]?.fileName;
        if (fileName) {
          try {
            await remove(`${dir}/${fileName}`);
          } catch {
            /* ok if missing */
          }
        }
      }

      await saveMimes(mimes.filter((m) => m.id !== id));
    },
    [mimes, saveMimes, ensureSpritesDir]
  );

  const getSpriteUrl = useCallback(
    async (fileName: string): Promise<string> => {
      const base = await appDataDir();
      return convertFileSrc(`${base}${SPRITES_DIR}/${fileName}`);
    },
    []
  );

  return { mimes, loaded, pickSpriteFile, addMime, deleteMime, getSpriteUrl };
}
