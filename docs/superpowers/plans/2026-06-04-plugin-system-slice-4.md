# Plugin System — Slice 4 Implementation Plan (Plugin Manager UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible **Plugins** tab in Settings that lists installed plugins and lets the user install a `.zip`, enable/disable, launch, and uninstall — making the plugin system tangible and usable through the UI.

**Architecture:** Pure frontend slice built against the backend commands that already exist (Slices 1–2): `get_plugins`, `install_plugin_from_dialog`, `uninstall_plugin`, `set_ani_plugin_enabled`, `launch_plugin`, plus the `plugins-changed` event. A `usePlugins` hook owns data + actions; a `PluginManager` component renders the panel; `Settings.tsx` gets a new tab. The e2e Tauri mock learns the plugin commands. No backend changes.

**Tech Stack:** React 19 + TypeScript, Vitest + React Testing Library (unit), Playwright (e2e). Tauri JS APIs: `invoke` from `@tauri-apps/api/core`, `listen` from `@tauri-apps/api/event`. Test mocks live in `src/__mocks__/` (`tauri.ts` exposes `mockInvoke`; `tauri-event.ts` exposes `emitMockEvent`).

**Spec:** `docs/superpowers/specs/2026-05-08-plugin-system-design.md` (Frontend section + Slice 4 row)

---

## Backend surface this slice consumes (already implemented — do NOT change)

Tauri commands (all registered in `src-tauri/src/lib.rs`):
- `get_plugins() -> Vec<PluginRecord>` — sorted by id.
- `install_plugin_from_dialog() -> Result<PluginRecord, String>` — opens a native file picker (`.zip` filter); errors `"install canceled"` if the user cancels; emits `plugins-changed` on success.
- `uninstall_plugin(id: String) -> Result<(), String>` — emits `plugins-changed`; also closes the plugin's window if open.
- `set_ani_plugin_enabled(id: String, enabled: bool) -> Result<(), String>` — emits `plugins-changed`; closes the window when disabling.
- `launch_plugin(id: String) -> Result<(), String>` — spawns/focuses the plugin's WebView.

`PluginRecord` serializes as (serde): `{ manifest, enabled: bool, status, webview_label? }` where:
- `manifest`: `{ id, name, version, description, author, entry, icon?, hotkey?, capabilities: string[], window }` and `window` uses **camelCase** keys: `{ width, height, resizable, alwaysOnTop, transparent, decorations }`.
- `status`: a tagged enum — `{ "type": "Loaded" }` or `{ "type": "Error", "reason": "<msg>" }`.
- `webview_label`: optional string (omitted when no window is open).

## File structure produced by this slice

```
src/
├── types/plugin.ts                       (new — TS mirrors of PluginRecord)
├── hooks/usePlugins.ts                   (new — data + actions)
├── components/PluginManager.tsx          (new — the Settings panel)
├── styles/plugin-manager.css             (new — styles)
├── components/Settings.tsx               (modified — new "plugins" tab)
└── __tests__/
    ├── hooks/usePlugins.test.ts          (new)
    └── components/PluginManager.test.tsx (new)
e2e/
├── tauri-mock.ts                         (modified — plugin command stubs)
└── plugin-manager.spec.ts                (new)
CLAUDE.md                                 (modified — frontend module rows)
.c3/                                      (via c3x only — register components/refs)
```

## Test conventions (match the existing codebase)

- Unit tests use Vitest + RTL. Tauri APIs are auto-mocked via vitest alias: `@tauri-apps/api/core` → `src/__mocks__/tauri.ts` (use `mockInvoke(cmd, response)` to register an `invoke` response; unregistered commands throw), `@tauri-apps/api/event` → `src/__mocks__/tauri-event.ts` (use `emitMockEvent(name, payload)` to fire a listened event; `listen` is a `vi.fn`). Mocks reset before each test (`src/__mocks__/setup.ts`).
- Run unit tests: `bunx vitest run src/__tests__/hooks/usePlugins.test.ts src/__tests__/components/PluginManager.test.tsx`
- Run e2e: `bunx playwright test -c e2e/playwright.config.ts --project=chromium plugin-manager`
- Type check: `npx tsc --noEmit`
- Every interactive/observable element gets a `data-testid` (kebab-case, parameterized with the plugin id) per CLAUDE.md Testing rules; use semantic HTML (`<button>`, `role="switch"`).

---

## Task 1: Plugin TypeScript types

**Files:**
- Create: `src/types/plugin.ts`

- [ ] **Step 1: Create the types file**

Create `src/types/plugin.ts`:

```ts
/** Frontend mirrors of the Rust `PluginRecord` (see src-tauri/src/plugin). */

/** Window config from the manifest (serde camelCase). */
export interface PluginWindowConfig {
  width: number;
  height: number;
  resizable: boolean;
  alwaysOnTop: boolean;
  transparent: boolean;
  decorations: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  icon?: string;
  hotkey?: string;
  capabilities: string[];
  window: PluginWindowConfig;
}

/** Tagged enum: `{ type: "Loaded" }` or `{ type: "Error", reason }`. */
export type PluginStatus =
  | { type: "Loaded" }
  | { type: "Error"; reason: string };

export interface PluginRecord {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  webview_label?: string;
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: exit 0 (no new errors). Types have no runtime, so no unit test.

- [ ] **Step 3: Commit**

```bash
git add src/types/plugin.ts
git commit -m "feat(plugin-ui): PluginRecord TypeScript types"
```

---

## Task 2: `usePlugins` hook

Owns the plugin list and the action callbacks. Loads via `get_plugins` on mount, refreshes on the `plugins-changed` event, and after each mutating action (belt-and-suspenders so the UI updates deterministically even if the event is missed). Install swallows the `"install canceled"` error (a cancel is not a failure).

**Files:**
- Create: `src/hooks/usePlugins.ts`
- Test: `src/__tests__/hooks/usePlugins.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/hooks/usePlugins.test.ts`:

```ts
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePlugins } from "../../hooks/usePlugins";
import { mockInvoke } from "../../__mocks__/tauri";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { invoke } from "@tauri-apps/api/core";
import type { PluginRecord } from "../../types/plugin";

function rec(id: string, enabled = true): PluginRecord {
  return {
    manifest: {
      id,
      name: id,
      version: "0.1.0",
      description: "",
      author: "",
      entry: "index.html",
      capabilities: ["window"],
      window: { width: 100, height: 100, resizable: false, alwaysOnTop: true, transparent: false, decorations: true },
    },
    enabled,
    status: { type: "Loaded" },
  };
}

describe("usePlugins", () => {
  it("loads plugins from get_plugins on mount", async () => {
    mockInvoke("get_plugins", [rec("translator")]);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plugins).toHaveLength(1);
    expect(result.current.plugins[0].manifest.id).toBe("translator");
  });

  it("refetches when plugins-changed fires", async () => {
    mockInvoke("get_plugins", [rec("a")]);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.plugins).toHaveLength(1));

    mockInvoke("get_plugins", [rec("a"), rec("b")]);
    await act(async () => {
      emitMockEvent("plugins-changed", undefined);
    });
    await waitFor(() => expect(result.current.plugins).toHaveLength(2));
  });

  it("setEnabled invokes the command with id + enabled", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("set_ani_plugin_enabled", null);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled("translator", false);
    });
    expect(invoke).toHaveBeenCalledWith("set_ani_plugin_enabled", { id: "translator", enabled: false });
  });

  it("uninstall invokes the command with id", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("uninstall_plugin", null);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.uninstall("translator");
    });
    expect(invoke).toHaveBeenCalledWith("uninstall_plugin", { id: "translator" });
  });

  it("launch invokes the command with id", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("launch_plugin", null);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.launch("translator");
    });
    expect(invoke).toHaveBeenCalledWith("launch_plugin", { id: "translator" });
  });

  it("install ignores a user cancel (no error set)", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("install_plugin_from_dialog", () => {
      throw new Error("install canceled");
    });
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.error).toBeNull();
  });

  it("install surfaces a real error", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("install_plugin_from_dialog", () => {
      throw new Error("manifest.json missing from zip");
    });
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.error).toMatch(/manifest.json missing/);
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `bunx vitest run src/__tests__/hooks/usePlugins.test.ts`
Expected: FAIL — cannot resolve `../../hooks/usePlugins`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/usePlugins.ts`:

```ts
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PluginRecord } from "../types/plugin";

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<PluginRecord[]>("get_plugins");
      setPlugins(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const un = listen("plugins-changed", () => {
      refresh();
    });
    return () => {
      un.then((fn) => fn());
    };
  }, [refresh]);

  const install = useCallback(async () => {
    setError(null);
    try {
      await invoke("install_plugin_from_dialog");
    } catch (e) {
      const msg = String(e);
      // A user cancel is not a failure.
      if (!/cancel/i.test(msg)) setError(msg);
    }
    await refresh();
  }, [refresh]);

  const uninstall = useCallback(async (id: string) => {
    setError(null);
    try {
      await invoke("uninstall_plugin", { id });
    } catch (e) {
      setError(String(e));
    }
    await refresh();
  }, [refresh]);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    setError(null);
    try {
      await invoke("set_ani_plugin_enabled", { id, enabled });
    } catch (e) {
      setError(String(e));
    }
    await refresh();
  }, [refresh]);

  const launch = useCallback(async (id: string) => {
    setError(null);
    try {
      await invoke("launch_plugin", { id });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { plugins, loading, error, install, uninstall, setEnabled, launch, refresh };
}
```

- [ ] **Step 4: Run tests, verify they PASS**

Run: `bunx vitest run src/__tests__/hooks/usePlugins.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePlugins.ts src/__tests__/hooks/usePlugins.test.ts
git commit -m "feat(plugin-ui): usePlugins hook"
```

---

## Task 3: Teach the e2e Tauri mock the plugin commands

The Playwright mock (`e2e/tauri-mock.ts`) has an `invoke(cmd, args)` switch. Add handlers backed by a `window.__MOCK_PLUGINS__` array so e2e tests can seed state and assert mutations. Because `usePlugins` calls `refresh()` (i.e. `get_plugins`) after each action, the mock only needs to keep `__MOCK_PLUGINS__` consistent — no event emission required.

**Files:**
- Modify: `e2e/tauri-mock.ts`

- [ ] **Step 1: Add the plugin command handlers**

In `e2e/tauri-mock.ts`, inside the `invoke` function, add these cases alongside the existing `if (cmd === ...)` checks (place them before the final `console.debug('[tauri-mock] unhandled invoke:'...)` fallback):

```js
    if (cmd === 'get_plugins') {
      return window.__MOCK_PLUGINS__ ?? [];
    }
    if (cmd === 'install_plugin_from_dialog') {
      // Test seeds the record to "install" via __MOCK_INSTALL_PLUGIN__.
      const rec = window.__MOCK_INSTALL_PLUGIN__;
      if (!rec) throw new Error('install canceled');
      window.__MOCK_PLUGINS__ = [...(window.__MOCK_PLUGINS__ ?? []), rec];
      return rec;
    }
    if (cmd === 'uninstall_plugin') {
      window.__MOCK_PLUGINS__ = (window.__MOCK_PLUGINS__ ?? []).filter(
        (p) => p.manifest.id !== args.id
      );
      return null;
    }
    if (cmd === 'set_ani_plugin_enabled') {
      window.__MOCK_PLUGINS__ = (window.__MOCK_PLUGINS__ ?? []).map((p) =>
        p.manifest.id === args.id ? { ...p, enabled: args.enabled } : p
      );
      return null;
    }
    if (cmd === 'launch_plugin') {
      window.__MOCK_LAUNCHED__ = window.__MOCK_LAUNCHED__ || [];
      window.__MOCK_LAUNCHED__.push(args.id);
      return null;
    }
```

- [ ] **Step 2: Verify the mock file still parses**

Run: `npx tsc --noEmit` (the e2e mock is type-checked by the project config; if e2e files are excluded from the root tsconfig, this is a no-op — that's fine).
Also run the existing e2e suite once to confirm no regression: `bunx playwright test -c e2e/playwright.config.ts --project=chromium settings 2>&1 | tail -20` (any existing settings spec). Expected: existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/tauri-mock.ts
git commit -m "test(plugin-ui): mock plugin commands in e2e Tauri mock"
```

---

## Task 4: `PluginManager` component

The panel: a header with an **Install plugin** button and a one-line description, a top-level error banner, an empty state, and one card per plugin. Each card shows name + version + capability chips, an enable/disable toggle (`role="switch"`), a **Launch** button (disabled when disabled or in error state), and an **Uninstall** button with a two-click inline confirm (no dialog dependency, so it's trivially testable). Error-state plugins show their reason.

**Files:**
- Create: `src/components/PluginManager.tsx`
- Create: `src/styles/plugin-manager.css`
- Test: `src/__tests__/components/PluginManager.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/PluginManager.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PluginManager } from "../../components/PluginManager";
import { mockInvoke } from "../../__mocks__/tauri";
import { invoke } from "@tauri-apps/api/core";
import type { PluginRecord } from "../../types/plugin";

function rec(id: string, over: Partial<PluginRecord> = {}): PluginRecord {
  return {
    manifest: {
      id, name: id, version: "0.1.0", description: "", author: "",
      entry: "index.html", capabilities: ["window", "storage"],
      window: { width: 100, height: 100, resizable: false, alwaysOnTop: true, transparent: false, decorations: true },
    },
    enabled: true,
    status: { type: "Loaded" },
    ...over,
  };
}

describe("PluginManager", () => {
  it("shows the empty state when no plugins are installed", async () => {
    mockInvoke("get_plugins", []);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-empty-state")).toBeInTheDocument();
  });

  it("renders a card per installed plugin", async () => {
    mockInvoke("get_plugins", [rec("translator"), rec("screenshot")]);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-card-translator")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-screenshot")).toBeInTheDocument();
  });

  it("shows an error badge with the reason for a broken plugin", async () => {
    mockInvoke("get_plugins", [rec("broken", { status: { type: "Error", reason: "bad manifest" } })]);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-error-broken")).toHaveTextContent("bad manifest");
  });

  it("launch button invokes launch_plugin", async () => {
    mockInvoke("get_plugins", [rec("translator")]);
    mockInvoke("launch_plugin", null);
    render(<PluginManager />);
    fireEvent.click(await screen.findByTestId("plugin-launch-btn-translator"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("launch_plugin", { id: "translator" }));
  });

  it("disables the launch button for a disabled plugin", async () => {
    mockInvoke("get_plugins", [rec("translator", { enabled: false })]);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-launch-btn-translator")).toBeDisabled();
  });

  it("toggle invokes set_ani_plugin_enabled with the negated state", async () => {
    mockInvoke("get_plugins", [rec("translator", { enabled: true })]);
    mockInvoke("set_ani_plugin_enabled", null);
    render(<PluginManager />);
    fireEvent.click(await screen.findByTestId("plugin-enable-toggle-translator"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_ani_plugin_enabled", { id: "translator", enabled: false })
    );
  });

  it("uninstall requires a second confirming click", async () => {
    mockInvoke("get_plugins", [rec("translator")]);
    mockInvoke("uninstall_plugin", null);
    render(<PluginManager />);
    const btn = await screen.findByTestId("plugin-uninstall-btn-translator");

    fireEvent.click(btn); // first click → arms confirm, does NOT invoke
    expect(invoke).not.toHaveBeenCalledWith("uninstall_plugin", { id: "translator" });

    fireEvent.click(screen.getByTestId("plugin-uninstall-btn-translator")); // second click → invokes
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("uninstall_plugin", { id: "translator" }));
  });

  it("install button invokes install_plugin_from_dialog", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("install_plugin_from_dialog", () => { throw new Error("install canceled"); });
    render(<PluginManager />);
    fireEvent.click(await screen.findByTestId("install-plugin-btn"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_plugin_from_dialog"));
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `bunx vitest run src/__tests__/components/PluginManager.test.tsx`
Expected: FAIL — cannot resolve `../../components/PluginManager`.

- [ ] **Step 3: Implement the component**

Create `src/components/PluginManager.tsx`:

```tsx
import { useState } from "react";
import { usePlugins } from "../hooks/usePlugins";
import type { PluginRecord } from "../types/plugin";
import "../styles/plugin-manager.css";

export function PluginManager() {
  const { plugins, loading, error, install, uninstall, setEnabled, launch } = usePlugins();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleUninstall = (id: string) => {
    if (confirmId === id) {
      setConfirmId(null);
      uninstall(id);
    } else {
      setConfirmId(id);
    }
  };

  return (
    <div className="plugin-manager" data-testid="plugin-manager">
      <div className="plugin-manager-header">
        <p className="plugin-manager-desc">
          Install mini-app plugins from a <code>.zip</code>. Plugins run in their own window.
        </p>
        <button
          type="button"
          className="plugin-install-btn"
          data-testid="install-plugin-btn"
          onClick={() => install()}
        >
          Install plugin…
        </button>
      </div>

      {error && (
        <div className="plugin-error-banner" role="alert" data-testid="plugin-error-banner">
          {error}
        </div>
      )}

      {loading ? (
        <p className="plugin-loading" data-testid="plugin-loading">Loading…</p>
      ) : plugins.length === 0 ? (
        <p className="plugin-empty" data-testid="plugin-empty-state">
          No plugins installed yet.
        </p>
      ) : (
        <ul className="plugin-list">
          {plugins.map((p) => (
            <PluginCard
              key={p.manifest.id}
              record={p}
              confirming={confirmId === p.manifest.id}
              onLaunch={() => launch(p.manifest.id)}
              onToggle={() => setEnabled(p.manifest.id, !p.enabled)}
              onUninstall={() => handleUninstall(p.manifest.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PluginCard({
  record,
  confirming,
  onLaunch,
  onToggle,
  onUninstall,
}: {
  record: PluginRecord;
  confirming: boolean;
  onLaunch: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}) {
  const { manifest, enabled, status } = record;
  const isError = status.type === "Error";

  return (
    <li className="plugin-card" data-testid={`plugin-card-${manifest.id}`}>
      <div className="plugin-card-main">
        <div className="plugin-card-title">
          <span className="plugin-name">{manifest.name}</span>
          <span className="plugin-version">v{manifest.version}</span>
        </div>
        {manifest.description && <p className="plugin-card-desc">{manifest.description}</p>}
        <div className="plugin-caps">
          {manifest.capabilities.map((c) => (
            <span key={c} className="plugin-cap-chip" data-testid={`plugin-cap-${manifest.id}-${c}`}>
              {c}
            </span>
          ))}
        </div>
        {isError && (
          <p className="plugin-error" data-testid={`plugin-error-${manifest.id}`}>
            {status.type === "Error" ? status.reason : ""}
          </p>
        )}
      </div>

      <div className="plugin-card-actions">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${manifest.name}`}
          className={`plugin-toggle ${enabled ? "on" : "off"}`}
          data-testid={`plugin-enable-toggle-${manifest.id}`}
          disabled={isError}
          onClick={onToggle}
        >
          {enabled ? "On" : "Off"}
        </button>
        <button
          type="button"
          className="plugin-launch-btn"
          data-testid={`plugin-launch-btn-${manifest.id}`}
          disabled={!enabled || isError}
          onClick={onLaunch}
        >
          Launch
        </button>
        <button
          type="button"
          className={`plugin-uninstall-btn ${confirming ? "confirming" : ""}`}
          data-testid={`plugin-uninstall-btn-${manifest.id}`}
          onClick={onUninstall}
        >
          {confirming ? "Confirm?" : "Uninstall"}
        </button>
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Create the stylesheet**

Create `src/styles/plugin-manager.css`:

```css
.plugin-manager { display: flex; flex-direction: column; gap: 12px; }
.plugin-manager-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.plugin-manager-desc { margin: 0; font-size: 13px; opacity: 0.8; }
.plugin-install-btn { padding: 6px 12px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
.plugin-error-banner { padding: 8px 10px; border-radius: 6px; background: rgba(220, 60, 60, 0.12); color: #b00020; font-size: 13px; }
.plugin-loading, .plugin-empty { opacity: 0.6; font-size: 13px; }
.plugin-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.plugin-card { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid rgba(128,128,128,0.25); border-radius: 8px; }
.plugin-card-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.plugin-card-title { display: flex; align-items: baseline; gap: 8px; }
.plugin-name { font-weight: 600; }
.plugin-version { font-size: 12px; opacity: 0.6; }
.plugin-card-desc { margin: 0; font-size: 12px; opacity: 0.8; }
.plugin-caps { display: flex; flex-wrap: wrap; gap: 4px; }
.plugin-cap-chip { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: rgba(128,128,128,0.18); }
.plugin-error { margin: 2px 0 0; font-size: 12px; color: #b00020; }
.plugin-card-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.plugin-toggle { min-width: 44px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.plugin-toggle.on { background: rgba(60, 180, 90, 0.2); }
.plugin-toggle:disabled { opacity: 0.4; cursor: not-allowed; }
.plugin-launch-btn { padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.plugin-launch-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.plugin-uninstall-btn { padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.plugin-uninstall-btn.confirming { background: rgba(220, 60, 60, 0.18); color: #b00020; }
```

- [ ] **Step 5: Run tests, verify they PASS**

Run: `bunx vitest run src/__tests__/components/PluginManager.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 6: Type check + commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add src/components/PluginManager.tsx src/styles/plugin-manager.css src/__tests__/components/PluginManager.test.tsx
git commit -m "feat(plugin-ui): PluginManager component"
```

---

## Task 5: Add the Plugins tab to Settings

Wire `PluginManager` into `src/components/Settings.tsx` as a new tab. Four small edits: import, extend the `Tab` union, add a `tabTitles` entry, add to the nav array, and render the panel.

**Files:**
- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: Add the import**

Near the other component imports (e.g. after the `import { SmartImport } from "./SmartImport";` line, ~line 21), add:

```tsx
import { PluginManager } from "./PluginManager";
```

- [ ] **Step 2: Extend the `Tab` union and titles**

Find (line ~74):

```tsx
type Tab = "general" | "mime" | "sound" | "claude" | "about";
```

Replace with:

```tsx
type Tab = "general" | "mime" | "sound" | "claude" | "plugins" | "about";
```

Then in the `tabTitles` record just below it, add a `plugins` entry (place it before `about:`):

```tsx
  plugins: "Plugins",
```

- [ ] **Step 3: Add to the nav array**

Find the nav map (line ~394):

```tsx
        {(["general", "mime", "sound", "claude", "about"] as Tab[]).map((t) => (
```

Replace the array with (insert `"plugins"` before `"about"`):

```tsx
        {(["general", "mime", "sound", "claude", "plugins", "about"] as Tab[]).map((t) => (
```

- [ ] **Step 4: Render the panel**

Find the end of the `{tab === "claude" && ( ... )}` block and the start of the `about` block. Immediately before the `about` tab's render block, add:

```tsx
        {tab === "plugins" && (
          <section className="settings-section" data-testid="settings-tab-plugins">
            <PluginManager />
          </section>
        )}
```

(Match the surrounding wrapper element/class the other tabs use — if they wrap content in `<section className="settings-section">` or similar, mirror it; the key requirement is `{tab === "plugins" && (<...><PluginManager /></...>)}` with a `data-testid="settings-tab-plugins"` on the wrapper.)

- [ ] **Step 5: Type check and run the existing Settings test**

Run: `npx tsc --noEmit` → exit 0.
Run: `bunx vitest run src/__tests__/components/Settings.test.tsx` → existing tests still pass. If a test asserts the exact set/number of tabs, update it to include "plugins" (read the test first; only change tab-count assertions, nothing else).

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings.tsx src/__tests__/components/Settings.test.tsx
git commit -m "feat(plugin-ui): add Plugins tab to Settings"
```

---

## Task 6: End-to-end test

Drive the full UI against the mocked backend: open Settings, go to the Plugins tab, see the empty state, install a (mock) plugin, see its card, launch it, disable it, and uninstall it.

**Files:**
- Create: `e2e/plugin-manager.spec.ts`

- [ ] **Step 1: Read an existing e2e spec for the harness pattern**

Read one existing spec under `e2e/*.spec.ts` (e.g. a settings spec) to copy exactly how it: loads the page with the Tauri mock injected, opens the Settings window/route, and sets `window.__MOCK_*` globals via `page.addInitScript` or `page.evaluate`. Mirror that setup — do not invent a new harness.

- [ ] **Step 2: Write the spec**

Create `e2e/plugin-manager.spec.ts` following the harness from Step 1. The test body should:

```ts
// Pseudocode of the assertions — adapt the page setup to match the existing specs.
//
// 1. Seed empty state: set window.__MOCK_PLUGINS__ = [] before load.
// 2. Navigate to Settings → click [data-testid="sidebar-item"] for Plugins
//    (or the nav button whose text is "Plugins"), then expect
//    [data-testid="plugin-empty-state"] visible.
// 3. Seed an install: set window.__MOCK_INSTALL_PLUGIN__ to a PluginRecord
//    with id "translator", click [data-testid="install-plugin-btn"], then
//    expect [data-testid="plugin-card-translator"] visible.
// 4. Click [data-testid="plugin-launch-btn-translator"], then assert
//    window.__MOCK_LAUNCHED__ contains "translator" (via page.evaluate).
// 5. Click [data-testid="plugin-enable-toggle-translator"]; expect its
//    aria-checked to become "false" and the launch button disabled.
// 6. Click [data-testid="plugin-uninstall-btn-translator"] twice (arm + confirm);
//    expect the card to disappear and [data-testid="plugin-empty-state"] to return.
```

Write the real Playwright test using the locators above and the page-setup pattern from the existing spec. Use `data-testid` locators (`page.getByTestId(...)`), not CSS classes.

- [ ] **Step 3: Run the e2e test**

Run: `bunx playwright test -c e2e/playwright.config.ts --project=chromium plugin-manager`
Expected: PASS. If the nav-item selector differs (the existing tabs may use a shared `sidebar-item` testid or only visible text), adjust the locator to match how the other Settings tabs are targeted in existing specs.

- [ ] **Step 4: Commit**

```bash
git add e2e/plugin-manager.spec.ts
git commit -m "test(plugin-ui): e2e for Plugin Manager flow"
```

---

## Task 7: C3 registration + docs

Slices 1–2 deferred C3 architecture-doc registration to "when the frontend lands" — that's now. Register the new components and the frontend→backend ref through the `c3x` CLI (never edit `.c3/` directly, per CLAUDE.md HARD RULE), and add the frontend module rows to `CLAUDE.md`.

**Files:**
- Modify: `.c3/**` (via `c3x` CLI / `/c3-skill:c3` only)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Register architecture via the C3 skill**

Invoke the C3 skill to register the plugin work. Run an `change`/`ref` operation that:
- Adds a backend component `plugin-system` owning `src-tauri/src/plugin/**` under container `c3-1` (if Slices 1–2 didn't already register it).
- Adds a frontend component `plugin-manager` owning `src/components/PluginManager.tsx`, `src/hooks/usePlugins.ts`, `src/types/plugin.ts`, `src/styles/plugin-manager.css` under container `c3-2`.
- Adds a ref `plugin-manager → plugin-system` (Tauri commands: get_plugins / install_plugin_from_dialog / uninstall_plugin / set_ani_plugin_enabled / launch_plugin + the `plugins-changed` event).

Use: `/c3-skill:c3` with the `change` then `ref` operations (the skill will run the `c3x` commands and validate). Do NOT hand-edit files under `.c3/`.

- [ ] **Step 2: Validate C3**

Run the c3 validator (via the skill or its bin): `c3x check`
Expected: zero issues. Fix any reported ownership gaps through `c3x` until clean.

- [ ] **Step 3: Add frontend module rows to CLAUDE.md**

In `CLAUDE.md`, in the Frontend (`src/`) module table, add rows (matching the existing `| Module | Responsibility |` style):

```markdown
| `components/PluginManager.tsx` | Settings "Plugins" tab — install (.zip) / list / enable / disable / launch / uninstall installed plugins |
| `hooks/usePlugins.ts` | Loads plugins via `get_plugins`, refreshes on `plugins-changed`, exposes install/uninstall/setEnabled/launch actions |
| `types/plugin.ts` | `PluginRecord` / `PluginManifest` / `PluginStatus` TypeScript mirrors of the Rust types |
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .c3
git commit -m "docs(plugin-ui): register C3 components + document Plugin Manager"
```

---

## End-of-slice verification

- [ ] `bunx vitest run src/__tests__/hooks/usePlugins.test.ts src/__tests__/components/PluginManager.test.tsx` — all pass (7 + 8).
- [ ] `bunx vitest run` — full unit suite green (no regressions, incl. Settings).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `bunx playwright test -c e2e/playwright.config.ts --project=chromium` — e2e green incl. the new plugin-manager spec.
- [ ] `c3x check` — zero issues.
- [ ] Manual: `bun run tauri dev` → open Settings → **Plugins** tab → Install a real plugin `.zip` → it appears → Launch opens its window → disable greys out Launch → Uninstall (confirm) removes it.

## Self-review notes (author)

- **Spec coverage:** Frontend section of the spec (PluginManager, usePlugins, types, styles, new Settings tab, data-testid discipline) + the Slice 4 row (UI + C3 registration) are all covered by Tasks 1–7.
- **Decision — refresh after actions:** `usePlugins` calls `refresh()` after each mutating action in addition to listening for `plugins-changed`. This makes the UI deterministic in unit/e2e (where the backend event isn't emitted) and is harmless in production (one extra `get_plugins`). The event listener still catches external changes (startup scan, other windows).
- **Decision — inline two-click uninstall confirm** instead of a native dialog: no `@tauri-apps/plugin-dialog` dependency in the component, so it's unit-testable without dialog mocks, and it still prevents accidental deletion.
- **Out of scope (later slices/post-v1):** global hotkey to launch (Slice 3), permission prompts at install, capability/permission display beyond the read-only capability chips, plugin icons rendering, marketplace/URL install.

## Open questions

1. **Disabled-plugin `plugin://` requests:** the protocol handler returns 403 for disabled plugins, and we already disable Launch in the UI for them, so there's no user-facing path to a 403. No action; just noting the UI and backend agree.
2. **Settings test tab-count assertion:** if `Settings.test.tsx` asserts an exact tab list/count, Task 5 Step 5 updates it. If it doesn't, no change. Confirm which during implementation.
3. **Slice 3 vs. 4 ordering:** this plan does Slice 4 before Slice 3 (hotkeys). The temporary `launch_plugin` command stays the launch path; Slice 3 later adds the hotkey caller without changing this UI.
