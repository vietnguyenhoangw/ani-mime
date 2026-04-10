# File Logging via tauri-plugin-log

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persistent file logging on both Rust and JS sides so users can share `~/Library/Logs/ani-mime/ani-mime.log` with Claude to diagnose bugs.

**Architecture:** Replace the homegrown `logger.rs` (in-memory buffer + `eprintln!`) with `tauri-plugin-log`, which writes to a log file via the standard Rust `log` crate. The existing `app_log!`/`app_warn!`/`app_error!` macros get redirected to `log::info!`/`log::warn!`/`log::error!`. JS frontend imports `error`/`warn`/`info` from `@tauri-apps/plugin-log` at key failure points. The in-memory `LogEntry` buffer and `get_logs`/`clear_logs` commands stay — they power the superpower tool UI.

**Tech Stack:** `tauri-plugin-log` v2 (Rust + JS), `log` crate v0.4

---

### Task 1: Install tauri-plugin-log

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`

**Step 1: Add Rust dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-log = "2"
log = "0.4"
```

**Step 2: Add JS dependency**

```bash
cd /Users/phong/Dev/ani-mime && bun add @tauri-apps/plugin-log
```

**Step 3: Add permission**

In `src-tauri/capabilities/default.json`, add `"log:default"` to the permissions array.

**Step 4: Verify it compiles**

```bash
cd /Users/phong/Dev/ani-mime/src-tauri && cargo check
```

Expected: compiles with no errors.

**Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock package.json bun.lock src-tauri/capabilities/default.json
git commit -m "chore: add tauri-plugin-log v2 dependency"
```

---

### Task 2: Register the log plugin in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:270-275` (the `run()` function, plugin registration block)

**Step 1: Add the plugin to the builder**

In `lib.rs`, inside `pub fn run()`, add the log plugin BEFORE the other plugins (it must initialize first so `log::*` macros work during setup):

```rust
use tauri_plugin_log::{Target, TargetKind, RotationStrategy};

// ... inside run():
tauri::Builder::default()
    .plugin(
        tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Debug)
            .level_for("tauri", log::LevelFilter::Info)
            .level_for("tao", log::LevelFilter::Info)
            .level_for("mdns_sd", log::LevelFilter::Warn)
            .targets([
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir { file_name: None }),
                Target::new(TargetKind::Webview),
            ])
            .rotation_strategy(RotationStrategy::KeepSome(3))
            .max_file_size(1_000_000) // 1MB
            .build(),
    )
    .plugin(tauri_plugin_opener::init())
    // ... rest of plugins
```

Notes:
- `level_for("mdns_sd", Warn)` — the mDNS crate is chatty at debug level
- `level_for("tauri", Info)` and `level_for("tao", Info)` — suppress framework noise

**Step 2: Verify it compiles**

```bash
cd /Users/phong/Dev/ani-mime/src-tauri && cargo check
```

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register tauri-plugin-log with file + stdout + webview targets"
```

---

### Task 3: Redirect Rust macros to the log crate

**Files:**
- Modify: `src-tauri/src/logger.rs:17-28` (the `push_log` function) and `39-58` (the macros)

**Step 1: Update push_log to also call log crate**

Replace the `push_log` function body to forward to the `log` crate while keeping the in-memory buffer for the superpower tool:

```rust
pub fn push_log(level: &'static str, msg: String) {
    // Forward to log crate (tauri-plugin-log picks this up → file + stdout + webview)
    match level {
        "error" => log::error!("{}", msg),
        "warn" => log::warn!("{}", msg),
        _ => log::info!("{}", msg),
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut buf = LOG_BUFFER.lock().unwrap();
    buf.push(LogEntry { timestamp, level, message: msg });
    let len = buf.len();
    if len > MAX_LOG_ENTRIES {
        buf.drain(..len - MAX_LOG_ENTRIES);
    }
}
```

Remove the `eprintln!` line — `tauri-plugin-log` Stdout target replaces it.

**Step 2: Verify it compiles**

```bash
cd /Users/phong/Dev/ani-mime/src-tauri && cargo check
```

**Step 3: Commit**

```bash
git add src-tauri/src/logger.rs
git commit -m "feat: redirect app_log/app_warn/app_error to log crate for file output"
```

---

### Task 4: Add JS log mock for tests

**Files:**
- Create: `src/__mocks__/tauri-log.ts`
- Modify: `vitest.config.ts` (add alias)
- Modify: `src/__mocks__/setup.ts` (add reset)

**Step 1: Create the mock**

Create `src/__mocks__/tauri-log.ts`:

```typescript
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
```

**Step 2: Add alias in vitest.config.ts**

Add to the `alias` object:

```typescript
"@tauri-apps/plugin-log": resolve(__dirname, "./src/__mocks__/tauri-log.ts"),
```

**Step 3: Add reset in setup.ts**

Add import and call:

```typescript
import { resetMocks as resetLog } from "./tauri-log";

// In beforeEach:
resetLog();
```

**Step 4: Run tests**

```bash
bun run test
```

Expected: all 152 tests pass.

**Step 5: Commit**

```bash
git add src/__mocks__/tauri-log.ts vitest.config.ts src/__mocks__/setup.ts
git commit -m "test: add tauri-plugin-log mock and vitest alias"
```

---

### Task 5: Add JS logging to useCustomMimes.ts

**Files:**
- Modify: `src/hooks/useCustomMimes.ts`

**Step 1: Add import**

```typescript
import { info, warn, error } from "@tauri-apps/plugin-log";
```

**Step 2: Add logging to ensureSpritesDir**

After `mkdir`:
```typescript
if (!(await exists(dir))) {
  await mkdir(dir, { recursive: true });
  info(`[custom-mimes] created sprites dir: ${dir}`);
}
```

**Step 3: Add logging to addMime**

At start of function:
```typescript
info(`[custom-mimes] addMime: name="${name}", id=${id}`);
```

After loop:
```typescript
info(`[custom-mimes] addMime: copied ${ALL_STATUSES.length} sprite files to ${dir}`);
```

**Step 4: Add logging to addMimeFromBlobs**

At start:
```typescript
info(`[custom-mimes] addMimeFromBlobs: name="${name}", id=${id}`);
```

Around writeFile:
```typescript
info(`[custom-mimes] writing ${fileName} (${blob.length} bytes)`);
```

**Step 5: Add logging to deleteMime**

```typescript
info(`[custom-mimes] deleteMime: id=${id}`);
```

**Step 6: Add logging to saveMimes**

```typescript
info(`[custom-mimes] persisted ${next.length} mimes to store`);
```

**Step 7: Run tests**

```bash
bun run test
```

Expected: all tests pass.

**Step 8: Commit**

```bash
git add src/hooks/useCustomMimes.ts
git commit -m "feat: add file logging to useCustomMimes operations"
```

---

### Task 6: Add JS logging to SmartImport.tsx

**Files:**
- Modify: `src/components/SmartImport.tsx`

**Step 1: Add import**

```typescript
import { info, error as logError } from "@tauri-apps/plugin-log";
```

Note: alias `error` as `logError` to avoid collision with the `error` state variable.

**Step 2: Add logging to handlePickSheet catch**

In the catch block (around line 135):
```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : "Failed to load image";
  logError(`[smart-import] handlePickSheet failed: ${msg}`);
  setError(msg);
}
```

**Step 3: Add logging to handleSave**

At start of try:
```typescript
info(`[smart-import] saving mime "${name}" with ${ALL_STATUSES.length} statuses`);
```

In the catch block (around line 199):
```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : "Failed to save mime";
  logError(`[smart-import] handleSave failed: ${msg}`);
  setError(msg);
}
```

After successful save (before `finally`):
```typescript
info(`[smart-import] save complete`);
```

**Step 4: Run tests**

```bash
bun run test
```

**Step 5: Commit**

```bash
git add src/components/SmartImport.tsx
git commit -m "feat: add file logging to SmartImport operations"
```

---

### Task 7: Add JS logging to Settings.tsx and Mascot.tsx

**Files:**
- Modify: `src/components/Settings.tsx:61-86` (loadPreviews effect)
- Modify: `src/components/Mascot.tsx:40-54` (custom sprite resolution effect)

**Step 1: Settings.tsx — add import and logging**

Add import:
```typescript
import { error as logError } from "@tauri-apps/plugin-log";
```

In `loadPreviews`, wrap the inner loop body in try/catch:
```typescript
for (const mime of customMimes) {
  const idleSprite = mime.sprites.idle;
  if (idleSprite) {
    try {
      const filePath = await join(base, "custom-sprites", idleSprite.fileName);
      const bytes = await readFile(filePath);
      if (cancelled) return;
      const blob = new Blob([bytes], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      previews[mime.id] = url;
    } catch (err) {
      logError(`[settings] failed to load preview for ${mime.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
```

**Step 2: Mascot.tsx — add import and logging**

Add import:
```typescript
import { error as logError } from "@tauri-apps/plugin-log";
```

Wrap the custom sprite resolution in try/catch:
```typescript
appDataDir().then(async (base) => {
  try {
    const filePath = await join(base, "custom-sprites", spriteData.fileName);
    const bytes = await readFile(filePath);
    if (revoked) return;
    const blob = new Blob([bytes], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    objectUrl = url;
    setCustomSpriteUrl(url);
  } catch (err) {
    logError(`[mascot] failed to load sprite ${spriteData.fileName}: ${err instanceof Error ? err.message : err}`);
  }
});
```

**Step 3: Run tests**

```bash
bun run test
```

**Step 4: Commit**

```bash
git add src/components/Settings.tsx src/components/Mascot.tsx
git commit -m "feat: add file logging to Settings preview loading and Mascot sprite resolution"
```

---

### Task 8: Smoke test — verify log file is written

**Step 1: Run the app**

```bash
cd /Users/phong/Dev/ani-mime && bun run tauri dev
```

**Step 2: Check log file exists**

```bash
ls -la ~/Library/Logs/ani-mime/
cat ~/Library/Logs/ani-mime/ani-mime.log | tail -20
```

Expected: log file exists with timestamped entries from Rust startup (`[app] starting Ani-Mime v0.14.19`, `[http] server started`, etc.)

**Step 3: Trigger a JS log**

Open Settings → Mime tab → click "Import" → pick a sprite sheet → click Save. Check the log file shows `[smart-import]` and `[custom-mimes]` entries.

**Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: persistent file logging via tauri-plugin-log"
```
