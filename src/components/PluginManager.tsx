import { useState, useEffect } from "react";
import { usePlugins } from "../hooks/usePlugins";
import type { PluginRecord } from "../types/plugin";
import "../styles/plugin-manager.css";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

const MAC_GLYPHS: Record<string, string> = {
  cmdorctrl: "⌘", cmd: "⌘", command: "⌘", super: "⌘", meta: "⌘",
  ctrl: "⌃", control: "⌃", shift: "⇧", alt: "⌥", option: "⌥",
};
const PC_LABELS: Record<string, string> = {
  cmdorctrl: "Ctrl", cmd: "Win", command: "Win", super: "Win", meta: "Win",
  ctrl: "Ctrl", control: "Ctrl", shift: "Shift", alt: "Alt", option: "Alt",
};

/** "CmdOrCtrl+Shift+V" → "⌘⇧V" (mac) or "Ctrl+Shift+V" (other). */
function formatHotkey(accelerator: string): string {
  const map = IS_MAC ? MAC_GLYPHS : PC_LABELS;
  const parts = accelerator.split("+").map((p) => p.trim()).filter(Boolean);
  const out = parts.map((p) => map[p.toLowerCase()] ?? p.toUpperCase());
  return out.join(IS_MAC ? "" : "+");
}

const NAMED_KEYS: Record<string, string> = {
  " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  ",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon", "'": "Quote",
  "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash",
  "-": "Minus", "=": "Equal", "`": "Backquote",
};

/** Same tokens, keyed by physical `KeyboardEvent.code` (unaffected by Option). */
const CODE_NAMED_KEYS: Record<string, string> = {
  Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  Comma: "Comma", Period: "Period", Slash: "Slash", Semicolon: "Semicolon", Quote: "Quote",
  BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backslash: "Backslash",
  Minus: "Minus", Equal: "Equal", Backquote: "Backquote",
};

/** The non-modifier key of a keydown, as a Tauri accelerator token, or null.
 *  Resolves from the physical `e.code` first: on macOS, holding Option rewrites
 *  `e.key` to a special character (⌥T → "†", ⌥E → "Dead"), which would otherwise
 *  make Option-based shortcuts impossible to assign. Falls back to `e.key` for
 *  environments/tests that don't populate `e.code`. */
function mainKeyToken(e: KeyboardEvent): string | null {
  const code = e.code;
  let m: RegExpExecArray | null;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (CODE_NAMED_KEYS[code]) return CODE_NAMED_KEYS[code];

  const k = e.key;
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return k;
  return NAMED_KEYS[k] ?? null;
}

/** Build a Tauri accelerator (e.g. "CmdOrCtrl+Shift+V") from a keydown, or
 *  null if it isn't a valid shortcut (needs ≥1 modifier + a real key). */
function buildAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push("CmdOrCtrl");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const key = mainKeyToken(e);
  if (!key || mods.length === 0) return null;
  return [...mods, key].join("+");
}

export function PluginManager() {
  const { plugins, loading, error, install, uninstall, setEnabled, launch, setHotkey } = usePlugins();
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
      <div className="settings-card">
        <div className="settings-row with-hint">
          <div>
            <span className="settings-row-label">Installed Plugins</span>
            <span className="settings-row-hint">
              Install mini-app plugins from a <code>.zip</code>. Each plugin runs in its own window.
            </span>
          </div>
          <button
            type="button"
            className="settings-action-btn"
            data-testid="install-plugin-btn"
            onClick={() => install()}
          >
            Install…
          </button>
        </div>
      </div>

      {error && (
        <div className="plugin-error-banner" role="alert" data-testid="plugin-error-banner">
          {error}
        </div>
      )}

      {loading ? (
        <p className="settings-section-desc" data-testid="plugin-loading">Loading…</p>
      ) : plugins.length === 0 ? (
        <p className="settings-section-desc" data-testid="plugin-empty-state">
          No plugins installed yet.
        </p>
      ) : (
        <div className="plugin-list">
          {plugins.map((p) => (
            <PluginCard
              key={p.manifest.id}
              record={p}
              confirming={confirmId === p.manifest.id}
              onLaunch={() => launch(p.manifest.id)}
              onToggle={() => setEnabled(p.manifest.id, !p.enabled)}
              onUninstall={() => handleUninstall(p.manifest.id)}
              onSetHotkey={(accel) => setHotkey(p.manifest.id, accel)}
            />
          ))}
        </div>
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
  onSetHotkey,
}: {
  record: PluginRecord;
  confirming: boolean;
  onLaunch: () => void;
  onToggle: () => void;
  onUninstall: () => void;
  onSetHotkey: (accelerator: string) => void;
}) {
  const { manifest, enabled, status } = record;
  const isError = status.type === "Error";
  const errorReason = status.type === "Error" ? status.reason : null;
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      // Ignore lone modifier presses — wait for a real key.
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const accel = buildAccelerator(e);
      if (accel) {
        setRecording(false);
        onSetHotkey(accel);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onSetHotkey]);

  return (
    <div
      className={`settings-card plugin-card ${enabled ? "" : "is-disabled"}`}
      data-testid={`plugin-card-${manifest.id}`}
    >
      <div className="plugin-card-head">
        <span className="plugin-name">
          {manifest.name}
          <span className="plugin-version">v{manifest.version}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${manifest.name}`}
          className={`toggle-switch ${enabled ? "active" : ""}`}
          data-testid={`plugin-enable-toggle-${manifest.id}`}
          disabled={isError}
          onClick={onToggle}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {manifest.description && (
        <p className="plugin-desc">{manifest.description}</p>
      )}

      {manifest.capabilities.length > 0 && (
        <div className="plugin-caps">
          {manifest.capabilities.map((c) => (
            <span key={c} className="plugin-cap-chip" data-testid={`plugin-cap-${manifest.id}-${c}`}>
              {c}
            </span>
          ))}
        </div>
      )}

      {errorReason && (
        <p className="plugin-error" data-testid={`plugin-error-${manifest.id}`}>
          {errorReason}
        </p>
      )}

      <div className="plugin-card-foot">
        {recording ? (
          <button
            type="button"
            className="plugin-hotkey recording"
            data-testid={`plugin-hotkey-${manifest.id}`}
            onClick={() => setRecording(false)}
          >
            Press keys… (Esc)
          </button>
        ) : manifest.hotkey ? (
          <button
            type="button"
            className="plugin-hotkey"
            data-testid={`plugin-hotkey-${manifest.id}`}
            title="Click to reassign shortcut"
            onClick={() => setRecording(true)}
          >
            {formatHotkey(manifest.hotkey)}
          </button>
        ) : (
          <button
            type="button"
            className="plugin-hotkey-add"
            data-testid={`plugin-hotkey-add-${manifest.id}`}
            title="Set a launch shortcut"
            onClick={() => setRecording(true)}
          >
            + Shortcut
          </button>
        )}
        <div className="plugin-foot-actions">
          <button
            type="button"
            className="settings-action-btn"
            data-testid={`plugin-launch-btn-${manifest.id}`}
            disabled={!enabled || isError}
            onClick={onLaunch}
          >
            Launch
          </button>
          <button
            type="button"
            className={`settings-action-btn ${confirming ? "plugin-uninstall-confirming" : ""}`}
            data-testid={`plugin-uninstall-btn-${manifest.id}`}
            onClick={onUninstall}
          >
            {confirming ? "Confirm?" : "Uninstall"}
          </button>
        </div>
      </div>
    </div>
  );
}
