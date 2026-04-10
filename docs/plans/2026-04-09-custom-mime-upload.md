# Custom Mime Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to create custom mimes by uploading PNG sprite strips for each animation state (idle, busy, service, disconnected, searching, initializing, visiting), naming the mime, and selecting it like any built-in character.

**Architecture:** Add `tauri-plugin-dialog` (file picker) and `tauri-plugin-fs` (copy files to app data). Custom mime metadata is stored in the existing Tauri store (`settings.json` under `customMimes` key). Sprite PNGs are copied to `{app_data_dir}/custom-sprites/`. The frontend resolves custom sprite URLs via `convertFileSrc()` from `@tauri-apps/api/core`. The `Pet` type widens from a string union to `string` to support dynamic custom IDs.

**Tech Stack:** Tauri 2 plugins (dialog, fs), React 19, @tauri-apps/api, TypeScript

---

### Task 1: Add Tauri Plugins (dialog + fs)

**Files:**
- Modify: `src-tauri/Cargo.toml` (add dependencies)
- Modify: `src-tauri/src/lib.rs:171-173` (register plugins)
- Modify: `src-tauri/capabilities/default.json` (add permissions)
- Modify: `package.json` (add JS packages)

**Step 1: Add Rust dependencies to Cargo.toml**

In `[dependencies]` section, add:

```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

**Step 2: Register plugins in lib.rs**

In the `tauri::Builder::default()` chain (line 171), add after the store plugin:

```rust
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_fs::init())
```

**Step 3: Add capabilities in default.json**

Add to the `permissions` array:

```json
"dialog:default",
"dialog:allow-open",
"fs:default",
"fs:allow-app-data-dir-read-write",
"fs:allow-read",
"fs:allow-write",
"fs:allow-exists",
"fs:allow-mkdir",
"fs:allow-copy-file",
"fs:allow-remove"
```

**Step 4: Install JS packages**

Run:
```bash
bun add @tauri-apps/plugin-dialog @tauri-apps/plugin-fs
```

**Step 5: Verify build compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors

**Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json bun.lock
git commit -m "feat: add tauri-plugin-dialog and tauri-plugin-fs for custom mime uploads"
```

---

### Task 2: Update Types for Custom Mimes

**Files:**
- Modify: `src/types/status.ts`

**Step 1: Widen Pet type and add CustomMimeInfo interface**

Replace the entire file content with:

```typescript
export type Status =
  | "initializing"
  | "searching"
  | "idle"
  | "busy"
  | "service"
  | "disconnected"
  | "visiting";

export interface SpriteConfig {
  file: string;
  frames: number;
}

// Built-in pet IDs kept as a reference set
export type BuiltinPet = "rottweiler" | "dalmatian" | "samurai" | "hancock" | "genjuro";

// Pet can be a built-in ID or a custom mime ID (e.g. "custom-abc123")
export type Pet = BuiltinPet | (string & {});

export type MimeCategory = "pet" | "character" | "custom";

export interface PetInfo {
  id: Pet;
  name: string;
  category: MimeCategory;
  preview: string;
  sprites: Record<Status, SpriteConfig>;
}

// Stored in settings.json under "customMimes"
export interface CustomMimeData {
  id: string;           // "custom-{timestamp}"
  name: string;
  sprites: Record<Status, { fileName: string; frames: number }>;
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: errors in files referencing old `MimeCategory` (only "pet" | "character"). Fix in next task.

**Step 3: Commit**

```bash
git add src/types/status.ts
git commit -m "feat: widen Pet type and add CustomMimeData interface"
```

---

### Task 3: Update sprites.ts to Support Custom Mimes

**Files:**
- Modify: `src/constants/sprites.ts`

**Step 1: Update mimeCategories and getSpriteMap**

Add "custom" to `mimeCategories` array:

```typescript
export const mimeCategories: { key: MimeCategory; label: string }[] = [
  { key: "pet", label: "Pet" },
  { key: "character", label: "Character" },
  { key: "custom", label: "Custom" },
];
```

Update `getSpriteMap` to accept an optional custom sprite map override:

```typescript
let customSpriteOverrides: Record<string, Record<Status, SpriteConfig>> = {};

export function registerCustomSprites(petId: string, sprites: Record<Status, SpriteConfig>) {
  customSpriteOverrides[petId] = sprites;
}

export function unregisterCustomSprites(petId: string) {
  delete customSpriteOverrides[petId];
}

export function getSpriteMap(petId: Pet): Record<Status, SpriteConfig> {
  if (customSpriteOverrides[petId]) {
    return customSpriteOverrides[petId];
  }
  const pet = pets.find((p) => p.id === petId);
  return pet ? pet.sprites : pets[0].sprites;
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/constants/sprites.ts
git commit -m "feat: add custom sprite registry to sprites.ts"
```

---

### Task 4: Create useCustomMimes Hook

**Files:**
- Create: `src/hooks/useCustomMimes.ts`

**Step 1: Implement the hook**

```typescript
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
  "idle", "busy", "service", "disconnected", "searching", "initializing", "visiting",
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
    const unlisten = listen<CustomMimeData[]>("custom-mimes-changed", (event) => {
      setMimes(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
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

  const addMime = useCallback(async (
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
      sprites: sprites as Record<Status, { fileName: string; frames: number }>,
    };

    await saveMimes([...mimes, newMime]);
    return id;
  }, [mimes, saveMimes, ensureSpritesDir]);

  const deleteMime = useCallback(async (id: string) => {
    const mime = mimes.find((m) => m.id === id);
    if (!mime) return;

    const dir = await ensureSpritesDir();
    for (const status of ALL_STATUSES) {
      const fileName = mime.sprites[status]?.fileName;
      if (fileName) {
        try { await remove(`${dir}/${fileName}`); } catch { /* ok if missing */ }
      }
    }

    await saveMimes(mimes.filter((m) => m.id !== id));
  }, [mimes, saveMimes, ensureSpritesDir]);

  const getSpriteUrl = useCallback(async (fileName: string): Promise<string> => {
    const base = await appDataDir();
    return convertFileSrc(`${base}${SPRITES_DIR}/${fileName}`);
  }, []);

  return { mimes, loaded, pickSpriteFile, addMime, deleteMime, getSpriteUrl };
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/hooks/useCustomMimes.ts
git commit -m "feat: add useCustomMimes hook for CRUD and file management"
```

---

### Task 5: Update Mascot.tsx to Render Custom Sprites

**Files:**
- Modify: `src/components/Mascot.tsx`

**Step 1: Add custom sprite URL resolution**

The Mascot needs to detect if the current pet is a custom mime and resolve the sprite URL from the filesystem instead of the bundled assets. Update Mascot.tsx:

```typescript
import { useState, useEffect, useRef } from "react";
import type { Status, CustomMimeData } from "../types/status";
import { getSpriteMap, autoStopStatuses } from "../constants/sprites";
import { usePet } from "../hooks/usePet";
import { useGlow } from "../hooks/useGlow";
import { useCustomMimes } from "../hooks/useCustomMimes";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import "../styles/mascot.css";

interface MascotProps {
  status: Status;
}

export function Mascot({ status }: MascotProps) {
  const { pet } = usePet();
  const { mode: glowMode } = useGlow();
  const { mimes } = useCustomMimes();
  const [frozen, setFrozen] = useState(false);
  const [customSpriteUrl, setCustomSpriteUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isCustom = pet.startsWith("custom-");
  const customMime = isCustom ? mimes.find((m) => m.id === pet) : null;

  useEffect(() => {
    clearTimeout(timerRef.current);
    setFrozen(false);

    if (autoStopStatuses.has(status)) {
      timerRef.current = setTimeout(() => setFrozen(true), 10_000);
    }

    return () => clearTimeout(timerRef.current);
  }, [status]);

  // Resolve custom sprite URL from filesystem
  useEffect(() => {
    if (!customMime) {
      setCustomSpriteUrl(null);
      return;
    }
    const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
    appDataDir().then((base) => {
      const url = convertFileSrc(`${base}custom-sprites/${spriteData.fileName}`);
      setCustomSpriteUrl(url);
    });
  }, [customMime, status]);

  // Get sprite config + URL
  let spriteUrl: string;
  let frames: number;

  if (isCustom && customMime) {
    const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
    frames = spriteData.frames;
    spriteUrl = customSpriteUrl ?? "";
  } else {
    const spriteMap = getSpriteMap(pet);
    const sprite = spriteMap[status] ?? spriteMap.searching;
    frames = sprite.frames;
    spriteUrl = new URL(
      `../assets/sprites/${sprite.file}`,
      import.meta.url
    ).href;
  }

  const lastFrameOffset = (frames - 1) * 128;

  if (isCustom && !customSpriteUrl) return null; // loading

  return (
    <div
      className={`sprite ${frozen ? "frozen" : ""} ${glowMode !== "off" ? `glow-${glowMode}` : ""}`}
      style={{
        backgroundImage: `url(${spriteUrl})`,
        width: 128,
        height: 128,
        "--sprite-steps": frames,
        "--sprite-width": `${frames * 128}px`,
        "--sprite-duration": `${frames * 80}ms`,
        ...(frozen ? { backgroundPosition: `-${lastFrameOffset}px 0` } : {}),
      } as React.CSSProperties}
    />
  );
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/Mascot.tsx
git commit -m "feat: support custom sprite URL resolution in Mascot"
```

---

### Task 6: Add Custom Mime Creator UI to Settings

**Files:**
- Modify: `src/components/Settings.tsx`
- Modify: `src/styles/settings.css`

**Step 1: Add the custom mime section and creation form to Settings.tsx**

Import the new hook and add a "Custom" section to the mime tab. The UI has two modes:
- **Browse mode**: Shows existing custom mimes in a grid with a "+" card to create new ones
- **Create mode**: Inline form with name input, file picker for each status, frame count inputs, and save/cancel

Add imports at the top of Settings.tsx:

```typescript
import { useCustomMimes, ALL_STATUSES } from "../hooks/useCustomMimes";
import type { Status } from "../types/status";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
```

Inside the `Settings` component, add state and the custom mime hook:

```typescript
const { mimes: customMimes, pickSpriteFile, addMime, deleteMime, getSpriteUrl } = useCustomMimes();
const [creating, setCreating] = useState(false);
const [newName, setNewName] = useState("");
const [spriteInputs, setSpriteInputs] = useState<
  Record<Status, { path: string; frames: number }>
>(() => {
  const init: any = {};
  for (const s of ALL_STATUSES) init[s] = { path: "", frames: 1 };
  return init;
});
const [customPreviews, setCustomPreviews] = useState<Record<string, string>>({});
```

Add a function to load preview URLs for custom mimes:

```typescript
useEffect(() => {
  const loadPreviews = async () => {
    const base = await appDataDir();
    const previews: Record<string, string> = {};
    for (const mime of customMimes) {
      const idleSprite = mime.sprites.idle;
      if (idleSprite) {
        previews[mime.id] = convertFileSrc(`${base}custom-sprites/${idleSprite.fileName}`);
      }
    }
    setCustomPreviews(previews);
  };
  loadPreviews();
}, [customMimes]);
```

Add handler functions:

```typescript
const handlePickFile = async (status: Status) => {
  const path = await pickSpriteFile();
  if (path) {
    setSpriteInputs((prev) => ({ ...prev, [status]: { ...prev[status], path } }));
  }
};

const handleFrameChange = (status: Status, frames: number) => {
  setSpriteInputs((prev) => ({ ...prev, [status]: { ...prev[status], frames } }));
};

const handleSaveCustom = async () => {
  const allFilled = ALL_STATUSES.every((s) => spriteInputs[s].path && spriteInputs[s].frames > 0);
  if (!newName.trim() || !allFilled) return;

  const spriteFiles: Record<Status, { sourcePath: string; frames: number }> = {} as any;
  for (const s of ALL_STATUSES) {
    spriteFiles[s] = { sourcePath: spriteInputs[s].path, frames: spriteInputs[s].frames };
  }

  const id = await addMime(newName.trim(), spriteFiles);
  setPet(id);
  setCreating(false);
  setNewName("");
  const init: any = {};
  for (const s of ALL_STATUSES) init[s] = { path: "", frames: 1 };
  setSpriteInputs(init);
};

const handleDeleteCustom = async (id: string) => {
  if (pet === id) setPet("rottweiler");
  await deleteMime(id);
};

const handleCancelCreate = () => {
  setCreating(false);
  setNewName("");
  const init: any = {};
  for (const s of ALL_STATUSES) init[s] = { path: "", frames: 1 };
  setSpriteInputs(init);
};
```

After the existing category `map()` block in the mime tab JSX, add the Custom section:

```tsx
<div className="settings-section">
  <div className="settings-section-title">Custom</div>
  {creating ? (
    <div className="custom-creator">
      <div className="settings-card" style={{ marginBottom: 10 }}>
        <div className="settings-row">
          <span className="settings-row-label">Name</span>
          <input
            type="text"
            className="settings-input"
            style={{ textAlign: "right" }}
            value={newName}
            placeholder="My Custom Mime"
            maxLength={20}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
      </div>
      <div className="settings-card">
        {ALL_STATUSES.map((s) => (
          <div className="settings-row" key={s}>
            <span className="settings-row-label status-label">{s}</span>
            <div className="sprite-input-group">
              <button className="sprite-pick-btn" onClick={() => handlePickFile(s)}>
                {spriteInputs[s].path
                  ? spriteInputs[s].path.split("/").pop()
                  : "Choose PNG"}
              </button>
              <input
                type="number"
                className="frame-count-input"
                min={1}
                max={99}
                value={spriteInputs[s].frames}
                onChange={(e) => handleFrameChange(s, Math.max(1, parseInt(e.target.value) || 1))}
                title="Frame count"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="custom-creator-actions">
        <button className="creator-btn cancel" onClick={handleCancelCreate}>
          Cancel
        </button>
        <button
          className="creator-btn save"
          onClick={handleSaveCustom}
          disabled={!newName.trim() || !ALL_STATUSES.every((s) => spriteInputs[s].path)}
        >
          Save
        </button>
      </div>
    </div>
  ) : (
    <div className="pet-grid">
      {customMimes.map((m) => (
        <div key={m.id} className="pet-card-wrapper">
          <button
            className={`pet-card ${pet === m.id ? "active" : ""}`}
            onClick={() => setPet(m.id)}
          >
            <div
              className="pet-preview"
              style={{
                backgroundImage: customPreviews[m.id] ? `url(${customPreviews[m.id]})` : "none",
                backgroundSize: "auto 48px",
                backgroundPosition: "0 0",
                backgroundRepeat: "no-repeat",
                imageRendering: "pixelated",
              }}
            />
            <span className="pet-name">{m.name}</span>
          </button>
          <button
            className="delete-mime-btn"
            onClick={(e) => { e.stopPropagation(); handleDeleteCustom(m.id); }}
            title="Delete"
          >
            x
          </button>
        </div>
      ))}
      <button className="pet-card add-card" onClick={() => setCreating(true)}>
        <div className="add-icon">+</div>
        <span className="pet-name">Create</span>
      </button>
    </div>
  )}
</div>
```

**Step 2: Add CSS for the custom creator**

Append to `src/styles/settings.css`:

```css
/* Custom mime creator */
.custom-creator {
  margin-top: 4px;
}

.status-label {
  text-transform: capitalize;
  min-width: 90px;
}

.sprite-input-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sprite-pick-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-family: inherit;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.sprite-pick-btn:hover {
  opacity: 1;
}

.frame-count-input {
  width: 42px;
  padding: 4px 6px;
  font-size: 11px;
  font-family: inherit;
  text-align: center;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 5px;
  background: transparent;
  color: inherit;
}

.frame-count-input:focus {
  border-color: #5e5ce6;
  outline: none;
}

.custom-creator-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.creator-btn {
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.creator-btn.cancel {
  background: rgba(128, 128, 128, 0.15);
  opacity: 0.7;
}

.creator-btn.cancel:hover {
  opacity: 1;
}

.creator-btn.save {
  background: #007aff;
  color: #fff;
}

.creator-btn.save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.creator-btn.save:not(:disabled):hover {
  background: #0063d1;
}

/* Add card */
.add-card {
  border-style: dashed !important;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.add-card:hover {
  opacity: 0.8;
}

.add-icon {
  font-size: 24px;
  font-weight: 300;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
}

/* Delete button */
.pet-card-wrapper {
  position: relative;
}

.delete-mime-btn {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: #ff3b30;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-family: inherit;
}

.pet-card-wrapper:hover .delete-mime-btn {
  display: flex;
}
```

**Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/Settings.tsx src/styles/settings.css
git commit -m "feat: add custom mime creator UI with file picker and delete"
```

---

### Task 7: Integration Test - Manual Verification

**Step 1: Start the dev server**

```bash
source "$HOME/.cargo/env" && bun run tauri dev
```

**Step 2: Verify the following in the app:**

1. Open Settings > Mime tab
2. Scroll down to see "Custom" section with a "+" Create card
3. Click "+" — the creation form appears with name input and 7 status rows
4. Click "Choose PNG" for each status — a file picker dialog opens, only showing .png files
5. Set frame counts for each status
6. Enter a name and click "Save"
7. The custom mime appears in the Custom grid
8. Click it to select — the main window shows the custom sprite animating
9. Hover over the custom mime card — a red "x" delete button appears
10. Click delete — the mime is removed, falls back to Rottweiler if it was selected
11. Close and reopen the app — custom mimes persist

**Step 3: Commit any fixes**

---

### Summary of All Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/Cargo.toml` | Modify | Add dialog + fs plugin deps |
| `src-tauri/src/lib.rs` | Modify | Register dialog + fs plugins |
| `src-tauri/capabilities/default.json` | Modify | Add dialog + fs permissions |
| `package.json` | Modify | Add JS plugin packages |
| `src/types/status.ts` | Modify | Widen Pet type, add CustomMimeData |
| `src/constants/sprites.ts` | Modify | Add custom category, sprite registry |
| `src/hooks/useCustomMimes.ts` | Create | Custom mime CRUD + file management |
| `src/components/Mascot.tsx` | Modify | Custom sprite URL resolution |
| `src/components/Settings.tsx` | Modify | Custom mime creator UI |
| `src/styles/settings.css` | Modify | Custom creator + delete button styles |
