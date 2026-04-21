import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit } from "@tauri-apps/api/event";
import { useTheme, type Theme } from "../hooks/useTheme";
import { usePet } from "../hooks/usePet";
import { useBubble } from "../hooks/useBubble";
import { useGlow, type GlowMode } from "../hooks/useGlow";
import { useNickname } from "../hooks/useNickname";
import { useAutoStart } from "../hooks/useAutoStart";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { useAutoInstall } from "../hooks/useAutoInstall";
import { useDockVisible } from "../hooks/useDockVisible";
import { useTrayVisible } from "../hooks/useTrayVisible";
import { useSessionList } from "../hooks/useSessionList";
import { useLanList } from "../hooks/useLanList";
import { mimeCategories, getMimesByCategory } from "../constants/sprites";
import { useScale } from "../hooks/useScale";
import { useOpacity, OPACITY_MIN, OPACITY_MAX } from "../hooks/useOpacity";
import { effects, useEffectEnabled } from "../effects";
import { useCustomMimes, ALL_STATUSES } from "../hooks/useCustomMimes";
import { SmartImport } from "./SmartImport";
import { AnimationPreview } from "./AnimationPreview";
import type { Status } from "../types/status";
import { readFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join, resourceDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import { useClaudeConfig } from "../hooks/useClaudeConfig";
import "../styles/settings.css";

const STATUS_DESCRIPTIONS: Record<Status, string> = {
  idle: "No commands running — the default resting state",
  busy: "A terminal command is actively running",
  service: "A long-running process (e.g. dev server) is active",
  disconnected: "No terminal sessions connected",
  searching: "App just launched, looking for terminal sessions",
  initializing: "First-launch setup in progress",
  visiting: "A friend's mime is visiting from the local network",
};

/** Parse a frame spec like "5", "1-5", or "41-55,57,58" into a total frame count. Returns 0 for invalid input. */
function parseFrameSpec(spec: string): number {
  const trimmed = spec.trim();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  let count = 0;
  for (const part of trimmed.split(",")) {
    const p = part.trim();
    const range = p.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      if (end < start) return 0;
      count += end - start + 1;
    } else if (/^\d+$/.test(p)) {
      count += 1;
    } else {
      return 0;
    }
  }
  return count;
}

export { parseFrameSpec };

type Tab = "general" | "mime" | "claude" | "about";

const tabTitles: Record<Tab, string> = {
  general: "General",
  mime: "Mime",
  claude: "Claude Code",
  about: "About",
};

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { pet, setPet } = usePet();
  const { enabled: bubbleEnabled, setEnabled: setBubbleEnabled } = useBubble();
  const { mode: glowMode, setMode: setGlowMode } = useGlow();
  const { nickname, setNickname } = useNickname();
  const { enabled: autoStartEnabled, setEnabled: setAutoStartEnabled } = useAutoStart();
  const { enabled: autoUpdateEnabled, setEnabled: setAutoUpdateEnabled } = useAutoUpdate();
  const { enabled: autoInstallEnabled, setEnabled: setAutoInstallEnabled } = useAutoInstall();
  const { hidden: dockHidden, setHidden: setDockHidden } = useDockVisible();
  const { hidden: trayHidden, setHidden: setTrayHidden } = useTrayVisible();
  const { enabled: sessionListEnabled, setEnabled: setSessionListEnabled } = useSessionList();
  const { enabled: lanListEnabled, setEnabled: setLanListEnabled } = useLanList();
  const { scale, setScale, SCALE_PRESETS } = useScale();
  const mimeOpacityHook = useOpacity("mime");
  const statusOpacityHook = useOpacity("status");
  const [draftMimeOpacity, setDraftMimeOpacity] = useState(1);
  const [savedMimeOpacity, setSavedMimeOpacity] = useState(1);
  const [mimeOpacityLoaded, setMimeOpacityLoaded] = useState(false);
  const [draftStatusOpacity, setDraftStatusOpacity] = useState(1);
  const [savedStatusOpacity, setSavedStatusOpacity] = useState(1);
  const [statusOpacityLoaded, setStatusOpacityLoaded] = useState(false);
  const mimeOpacityChanged = mimeOpacityLoaded && Math.abs(draftMimeOpacity - savedMimeOpacity) > 0.001;
  const statusOpacityChanged = statusOpacityLoaded && Math.abs(draftStatusOpacity - savedStatusOpacity) > 0.001;

  useEffect(() => {
    mimeOpacityHook.loadSavedOpacity().then((v) => {
      setDraftMimeOpacity(v);
      setSavedMimeOpacity(v);
      setMimeOpacityLoaded(true);
    });
    statusOpacityHook.loadSavedOpacity().then((v) => {
      setDraftStatusOpacity(v);
      setSavedStatusOpacity(v);
      setStatusOpacityLoaded(true);
    });
    return () => {
      mimeOpacityHook.loadSavedOpacity().then((v) => mimeOpacityHook.previewOpacity(v));
      statusOpacityHook.loadSavedOpacity().then((v) => statusOpacityHook.previewOpacity(v));
    };
  }, []);
  const { mimes: customMimes, pickSpriteFile, addMime, addMimeFromBlobs, updateMime, updateMimeFromSmartImport, deleteMime, exportMime, importMime } = useCustomMimes();
  const claude = useClaudeConfig();
  const [expandedCommand, setExpandedCommand] = useState<string | null>(null);
  const [commandContent, setCommandContent] = useState<Record<string, string>>({});
  // const [expandedPluginSkills, setExpandedPluginSkills] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>("general");
  const [creating, setCreating] = useState<false | "manual" | "smart">(false);
  const [smartImportPath, setSmartImportPath] = useState<string | null>(null);
  const [editingMime, setEditingMime] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [spriteInputs, setSpriteInputs] = useState<
    Record<Status, { path: string; frames: string }>
  >(() => {
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = { path: "", frames: "1" };
    return init;
  });
  const [customPreviews, setCustomPreviews] = useState<Record<string, string>>({});
  const [manualAnimPreview, setManualAnimPreview] = useState<{ url: string; frames: number; label: string } | null>(null);
  const [draftNickname, setDraftNickname] = useState(nickname);
  const nicknameChanged = draftNickname !== nickname;

  useEffect(() => {
    setDraftNickname(nickname);
  }, [nickname]);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const loadPreviews = async () => {
      const base = await appDataDir();
      const previews: Record<string, string> = {};
      for (const mime of customMimes) {
        const idleSprite = mime.sprites.idle;
        if (idleSprite) {
          try {
            const filePath = await join(base, "custom-sprites", idleSprite.fileName);
            const bytes = await readFile(filePath);
            if (cancelled) return;
            const blob = new Blob([bytes], { type: "image/png" });
            const sheetUrl = URL.createObjectURL(blob);
            // Extract first frame only so grid sheets don't show all frames
            const url = await new Promise<string>((resolve) => {
              const img = new Image();
              img.onload = () => {
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                // Infer frame size: try 128 first, then fall back to sheet height
                const fp = [128, 64].find((s) => w >= s && h >= s && Number.isInteger(w / s)) ?? h;
                const canvas = document.createElement("canvas");
                canvas.width = fp;
                canvas.height = fp;
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(img, 0, 0, fp, fp, 0, 0, fp, fp);
                URL.revokeObjectURL(sheetUrl);
                resolve(canvas.toDataURL("image/png"));
              };
              img.onerror = () => {
                resolve(sheetUrl);
              };
              img.src = sheetUrl;
            });
            if (cancelled) return;
            urls.push(url);
            previews[mime.id] = url;
          } catch (err) {
            logError(`[settings] failed to load preview for ${mime.id}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
      if (!cancelled) setCustomPreviews(previews);
    };
    loadPreviews();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [customMimes]);

  const [devMode, setDevMode] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Dev mode is session-only: always starts off, cleared on app restart
  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      await store.set("devMode", false);
      await store.save();
    });
  }, []);

  const handleVersionClick = async () => {
    clickCountRef.current += 1;
    clearTimeout(clickTimerRef.current);

    if (clickCountRef.current >= 10) {
      clickCountRef.current = 0;
      if (!devMode) {
        setDevMode(true);
      }
      await emit("dev-mode-changed", true);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 3000);
    }
  };

  const handlePickFile = async (status: Status) => {
    const path = await pickSpriteFile();
    if (!path) return;

    // Auto-detect frame count from image dimensions (width / height for square-frame strips)
    let detectedFrames = "1";
    try {
      const bytes = await readFile(path);
      const blob = new Blob([bytes], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      URL.revokeObjectURL(url);
      if (img.height > 0 && img.width >= img.height) {
        detectedFrames = String(Math.round(img.width / img.height));
      }
    } catch {
      // If detection fails, keep default "1"
    }

    setSpriteInputs((prev) => ({
      ...prev,
      [status]: { path, frames: detectedFrames },
    }));
  };

  const handleFrameChange = (status: Status, value: string) => {
    setSpriteInputs((prev) => ({ ...prev, [status]: { ...prev[status], frames: value } }));
  };

  const handleManualPreview = async (status: Status) => {
    const filePath = spriteInputs[status].path;
    if (!filePath) return;
    try {
      const frameCount = parseFrameSpec(spriteInputs[status].frames);
      if (frameCount <= 0) return;
      const bytes = await readFile(filePath);
      if (manualAnimPreview?.url) URL.revokeObjectURL(manualAnimPreview.url);
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      setManualAnimPreview({ url, frames: frameCount, label: status });
    } catch (err) {
      logError(`[settings] failed to preview ${status}: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleSaveCustom = async () => {
    if (!newName.trim()) { setSaveError("Name is required"); return; }
    const missingSprite = ALL_STATUSES.find((s) => !spriteInputs[s].path);
    if (missingSprite) { setSaveError(`Sprite for "${missingSprite}" is required`); return; }
    const badFrames = ALL_STATUSES.find((s) => parseFrameSpec(spriteInputs[s].frames) <= 0);
    if (badFrames) { setSaveError(`Invalid frame count for "${badFrames}"`); return; }

    setSaveError(null);
    const spriteFiles: Record<Status, { sourcePath: string; frames: number }> = {} as any;
    for (const s of ALL_STATUSES) {
      spriteFiles[s] = { sourcePath: spriteInputs[s].path, frames: parseFrameSpec(spriteInputs[s].frames) };
    }

    const id = await addMime(newName.trim(), spriteFiles);
    setPet(id);
    setCreating(false);
    setNewName("");
    clearManualPreviews();
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = { path: "", frames: "1" };
    setSpriteInputs(init);
  };

  const handleEditCustom = async (id: string) => {
    const mime = customMimes.find((m) => m.id === id);
    if (!mime) return;
    setEditingMime(id);

    if (mime.smartImportMeta) {
      const base = await appDataDir();
      const path = await join(base, "custom-sprites", mime.smartImportMeta.sheetFileName);
      setSmartImportPath(path);
      setCreating("smart");
      setNewName(mime.name);
      return;
    }

    setCreating("manual");
    setNewName(mime.name);
    const filled: any = {};
    for (const s of ALL_STATUSES) {
      filled[s] = { path: "", frames: String(mime.sprites[s].frames) };
    }
    setSpriteInputs(filled);
  };

  const handleSaveEdit = async () => {
    if (!editingMime) return;
    if (!newName.trim()) { setSaveError("Name is required"); return; }
    const badFrames = ALL_STATUSES.find((s) => parseFrameSpec(spriteInputs[s].frames) <= 0);
    if (badFrames) { setSaveError(`Invalid frame count for "${badFrames}"`); return; }

    setSaveError(null);
    const spriteFiles: Record<Status, { sourcePath: string | null; frames: number }> = {} as any;
    for (const s of ALL_STATUSES) {
      spriteFiles[s] = {
        sourcePath: spriteInputs[s].path || null,
        frames: parseFrameSpec(spriteInputs[s].frames),
      };
    }

    await updateMime(editingMime, newName.trim(), spriteFiles);
    setEditingMime(null);
    setCreating(false);
    setNewName("");
    clearManualPreviews();
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = { path: "", frames: "1" };
    setSpriteInputs(init);
  };

  const handleDeleteCustom = async (id: string) => {
    if (pet === id) setPet("rottweiler");
    await deleteMime(id);
  };

  const clearManualPreviews = () => {
    if (manualAnimPreview?.url) URL.revokeObjectURL(manualAnimPreview.url);
    setManualAnimPreview(null);
  };

  const handleCancelCreate = () => {
    setCreating(false);
    setEditingMime(null);
    setSaveError(null);
    setNewName("");
    clearManualPreviews();
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = { path: "", frames: "1" };
    setSpriteInputs(init);
  };

  return (
    <div className="settings">
      <nav className="settings-sidebar">
        {(["general", "mime", "claude", "about"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`sidebar-item ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {tabTitles[t]}
          </button>
        ))}
      </nav>
      <main className="settings-content">
        <h1 className="settings-title">{tabTitles[tab]}</h1>
        {tab === "general" && (
          <>
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Glow Effect</span>
                <div className="theme-toggle">
                  {(["off", "light", "dark"] as GlowMode[]).map((g) => (
                    <button
                      key={g}
                      className={glowMode === g ? "active" : ""}
                      onClick={() => setGlowMode(g)}
                    >
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Theme</span>
                <div className="theme-toggle">
                  {(["dark", "light"] as Theme[]).map((t) => (
                    <button
                      key={t}
                      className={theme === t ? "active" : ""}
                      onClick={() => setTheme(t)}
                    >
                      {t === "dark" ? "Dark" : "Light"}
                    </button>
                  ))}
                </div>
              </div>
              {effects.map((effect) => (
                <EffectToggle key={effect.id} effectId={effect.id} name={effect.name} />
              ))}
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Transparency</div>
            <div className="settings-card">
              <div className="settings-row-stack">
                <div>
                  <span className="settings-row-label">Mime Opacity</span>
                  <span className="settings-row-hint">How transparent your mime looks. Drag to preview, Save to keep.</span>
                </div>
                <div className="opacity-slider-group">
                  <input
                    type="range"
                    className="opacity-slider"
                    min={OPACITY_MIN}
                    max={OPACITY_MAX}
                    step={0.05}
                    value={draftMimeOpacity}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setDraftMimeOpacity(v);
                      mimeOpacityHook.previewOpacity(v);
                    }}
                    data-testid="mime-opacity-slider"
                    aria-label="Mime opacity"
                  />
                  <span className="opacity-value" data-testid="mime-opacity-value">
                    {Math.round(draftMimeOpacity * 100)}%
                  </span>
                  <button
                    className={`nickname-save ${mimeOpacityChanged ? "active" : ""}`}
                    disabled={!mimeOpacityChanged}
                    onClick={async () => {
                      await mimeOpacityHook.setOpacity(draftMimeOpacity);
                      setSavedMimeOpacity(draftMimeOpacity);
                    }}
                    data-testid="mime-opacity-save"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="settings-row-stack">
                <div>
                  <span className="settings-row-label">Status Bar Opacity</span>
                  <span className="settings-row-hint">How transparent the status pill looks. Drag to preview, Save to keep.</span>
                </div>
                <div className="opacity-slider-group">
                  <input
                    type="range"
                    className="opacity-slider"
                    min={OPACITY_MIN}
                    max={OPACITY_MAX}
                    step={0.05}
                    value={draftStatusOpacity}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setDraftStatusOpacity(v);
                      statusOpacityHook.previewOpacity(v);
                    }}
                    data-testid="status-opacity-slider"
                    aria-label="Status bar opacity"
                  />
                  <span className="opacity-value" data-testid="status-opacity-value">
                    {Math.round(draftStatusOpacity * 100)}%
                  </span>
                  <button
                    className={`nickname-save ${statusOpacityChanged ? "active" : ""}`}
                    disabled={!statusOpacityChanged}
                    onClick={async () => {
                      await statusOpacityHook.setOpacity(draftStatusOpacity);
                      setSavedStatusOpacity(draftStatusOpacity);
                    }}
                    data-testid="status-opacity-save"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Status Bar</div>
            <div className="settings-card">
              <div className="settings-row with-hint">
                <div>
                  <span className="settings-row-label">Session List</span>
                  <span className="settings-row-hint">Click the status pill to see all open terminals grouped by project, with click-to-focus.</span>
                </div>
                <button
                  className={`toggle-switch ${sessionListEnabled ? "active" : ""}`}
                  onClick={() => setSessionListEnabled(!sessionListEnabled)}
                  data-testid="session-list-toggle"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-row with-hint">
                <div>
                  <span className="settings-row-label">LAN Peer List</span>
                  <span className="settings-row-hint">Show the nearby-peers icon on the status pill. Turn off to hide it entirely.</span>
                </div>
                <button
                  className={`toggle-switch ${lanListEnabled ? "active" : ""}`}
                  onClick={() => setLanListEnabled(!lanListEnabled)}
                  data-testid="lan-list-toggle"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Behavior</div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Start at Login</span>
                <button
                  className={`toggle-switch ${autoStartEnabled ? "active" : ""}`}
                  onClick={() => setAutoStartEnabled(!autoStartEnabled)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-row with-hint">
                <div>
                  <span className="settings-row-label">Automatically Check for Updates</span>
                  <span className="settings-row-hint">We recommend keeping this on. Updates include improvements and bug fixes for a better experience.</span>
                </div>
                <button
                  className={`toggle-switch ${autoUpdateEnabled ? "active" : ""}`}
                  onClick={() => setAutoUpdateEnabled(!autoUpdateEnabled)}
                  data-testid="settings-auto-update-toggle"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-row with-hint">
                <div>
                  <span className="settings-row-label">Install Updates Automatically</span>
                  <span className="settings-row-hint">When enabled, new versions install without asking. A Terminal window will run the Homebrew upgrade and the app will restart.</span>
                </div>
                <button
                  className={`toggle-switch ${autoInstallEnabled ? "active" : ""}`}
                  onClick={() => setAutoInstallEnabled(!autoInstallEnabled)}
                  disabled={!autoUpdateEnabled}
                  data-testid="settings-auto-install-toggle"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Speech Bubbles</span>
                <button
                  className={`toggle-switch ${bubbleEnabled ? "active" : ""}`}
                  onClick={() => setBubbleEnabled(!bubbleEnabled)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-row with-hint">
                <div>
                  <span className="settings-row-label">Hide from Dock</span>
                  <span className="settings-row-hint">Hide the app from Dock and Cmd+Tab. Access via the menu bar icon instead.</span>
                </div>
                <button
                  className={`toggle-switch ${dockHidden ? "active" : ""}`}
                  onClick={async () => {
                    const next = !dockHidden;
                    // When hiding the Dock, force the menu bar icon on so the
                    // user always has a way to reopen Settings.
                    if (next && trayHidden) await setTrayHidden(false);
                    await setDockHidden(next);
                  }}
                  data-testid="hide-dock-toggle"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-row with-hint">
                <div>
                  <span className="settings-row-label">Show in Menu Bar</span>
                  <span className="settings-row-hint">
                    {dockHidden
                      ? "Required while the Dock icon is hidden — otherwise there'd be no way to reopen Settings."
                      : "Show the tray icon in the macOS menu bar for quick access."}
                  </span>
                </div>
                <button
                  className={`toggle-switch ${!trayHidden ? "active" : ""} ${dockHidden ? "locked" : ""}`}
                  onClick={() => {
                    if (dockHidden) return;
                    setTrayHidden(!trayHidden);
                  }}
                  disabled={dockHidden}
                  aria-disabled={dockHidden}
                  title={dockHidden ? "Locked on while Dock is hidden" : undefined}
                  data-testid="show-tray-toggle"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="settings-row with-hint">
                <div>
                  <span className="settings-row-label">Local Network Access</span>
                  <span className="settings-row-hint">
                    Required for peer visits so nearby pets can discover each other. <br/><br/>
                    Clicking opens <strong>System Settings → Privacy &amp; Security</strong> —
                    scroll to <strong>Local Network</strong> and enable the toggle for <strong>Ani-Mime</strong>.
                  </span>
                </div>
                <button
                  className="settings-action-btn"
                  data-testid="request-local-network-btn"
                  onClick={() => invoke("request_local_network").catch((e) => logError(`[settings] request_local_network failed: ${e}`))}
                >
                  Request Permission
                </button>
              </div>
            </div>
          </div>
          </>
        )}
        {tab === "mime" && (
          <>
            <p className="mime-desc">Select your mime</p>
            <div className="settings-section">
              <div className="settings-section-title">Identity</div>
              <div className="settings-card">
                <div className="settings-row">
                  <span className="settings-row-label">Nickname</span>
                  <div className="nickname-group">
                    <input
                      type="text"
                      className="settings-input"
                      style={{ textAlign: "right" }}
                      value={draftNickname}
                      placeholder="Enter your name"
                      maxLength={20}
                      onChange={(e) => setDraftNickname(e.target.value)}
                    />
                    <button
                      className={`nickname-save ${nicknameChanged ? "active" : ""}`}
                      disabled={!nicknameChanged}
                      onClick={() => setNickname(draftNickname)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">Display Size</div>
              <div className="settings-card">
                <div className="settings-row">
                  <span className="settings-row-label">Scale</span>
                  <div className="theme-toggle">
                    {SCALE_PRESETS.map((s) => {
                      const labels: Record<number, string> = { 0.5: "Tiny", 1: "Normal", 1.5: "Large", 2: "XL" };
                      return (
                        <button
                          key={s}
                          className={scale === s ? "active" : ""}
                          onClick={() => setScale(s)}
                        >
                          {labels[s]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            {mimeCategories.filter((cat) => cat.key !== "custom").map((cat) => {
              const mimes = getMimesByCategory(cat.key);
              if (mimes.length === 0) return null;
              return (
                <div className="settings-section" key={cat.key}>
                  <div className="settings-section-title">{cat.label}</div>
                  <div className="pet-grid">
                    {mimes.map((p) => {
                      const previewUrl = new URL(
                        `../assets/sprites/${p.preview}`,
                        import.meta.url
                      ).href;
                      return (
                        <button
                          key={p.id}
                          className={`pet-card ${pet === p.id ? "active" : ""}`}
                          onClick={() => setPet(p.id)}
                        >
                          <div
                            className="pet-preview"
                            style={{
                              backgroundImage: `url(${previewUrl})`,
                              backgroundSize: `auto 48px`,
                              backgroundPosition: "0 0",
                              backgroundRepeat: "no-repeat",
                              imageRendering: "pixelated",
                            }}
                          />
                          <span className="pet-name">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="settings-section">
              <div className="settings-section-title">Create Your Own</div>
              <p className="settings-section-desc">
                Import a sprite sheet or pick individual PNGs to build your own mime.{" "}
                <a
                  className="settings-link"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      const dir = await resourceDir();
                      const path = await join(dir, "docs", "custom-mime-guide.pdf");
                      console.log("[settings] opening guide:", path);
                      await openPath(path);
                    } catch (err) {
                      console.error("[settings] failed to open guide:", err);
                      logError(`[settings] failed to open guide: ${err instanceof Error ? err.message : err}`);
                    }
                  }}
                >
                  Read the guide
                </a>
              </p>
              {creating === "manual" ? (
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
                      <div className="manual-status-row" key={s}>
                        <div className="settings-row">
                          <div>
                            <span className="settings-row-label status-label">{s}</span>
                            <div className="status-desc">{STATUS_DESCRIPTIONS[s]}</div>
                          </div>
                          <div className="sprite-input-group">
                            <button className="sprite-pick-btn" onClick={() => handlePickFile(s)}>
                              {spriteInputs[s].path
                                ? spriteInputs[s].path.split("/").pop()
                                : editingMime
                                  ? customMimes.find((m) => m.id === editingMime)?.sprites[s]?.fileName ?? "Choose PNG"
                                  : "Choose PNG"}
                            </button>
                            <input
                              type="text"
                              className="frame-count-input"
                              value={spriteInputs[s].frames}
                              onChange={(e) => handleFrameChange(s, e.target.value)}
                              placeholder="e.g. 1-5"
                              title="Frame count or range (e.g. 1-5, 41-55,57,58)"
                            />
                            <button
                              className="manual-preview-btn"
                              disabled={!spriteInputs[s].path}
                              onClick={() => handleManualPreview(s)}
                            >
                              Preview
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {saveError && <div className="save-error">{saveError}</div>}
                  <div className="custom-creator-actions">
                    <button className="creator-btn cancel" onClick={handleCancelCreate}>
                      Cancel
                    </button>
                    <button
                      className="creator-btn save"
                      onClick={editingMime ? handleSaveEdit : handleSaveCustom}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : creating === "smart" ? (
                <SmartImport
                  initialFilePath={smartImportPath ?? undefined}
                  initialName={editingMime ? customMimes.find((m) => m.id === editingMime)?.name : undefined}
                  initialFrameInputs={
                    editingMime
                      ? customMimes.find((m) => m.id === editingMime)?.smartImportMeta?.frameInputs
                      : undefined
                  }
                  editingId={editingMime ?? undefined}
                  onSave={async (mimeName, blobs, meta) => {
                    if (editingMime) {
                      await updateMimeFromSmartImport(
                        editingMime,
                        mimeName,
                        blobs,
                        meta.sheetBlob,
                        meta.frameInputs
                      );
                      setEditingMime(null);
                    } else {
                      const id = await addMimeFromBlobs(mimeName, blobs, meta);
                      setPet(id);
                    }
                    setCreating(false);
                    setSmartImportPath(null);
                  }}
                  onCancel={() => { handleCancelCreate(); setSmartImportPath(null); }}
                />
              ) : (
                <>
                  {customMimes.length > 0 && (
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
                                backgroundSize: "contain",
                                backgroundPosition: "center",
                                backgroundRepeat: "no-repeat",
                                imageRendering: "pixelated",
                              }}
                            />
                            <span className="pet-name">{m.name}</span>
                          </button>
                          <button
                            className="edit-mime-btn"
                            onClick={(e) => { e.stopPropagation(); handleEditCustom(m.id); }}
                            title="Edit"
                            data-testid={`edit-mime-${m.id}`}
                          >
                            &#9998;
                          </button>
                          <button
                            className="export-mime-btn"
                            onClick={(e) => { e.stopPropagation(); exportMime(m.id); }}
                            title="Export"
                            data-testid={`export-mime-${m.id}`}
                            aria-label="Export mime"
                          >
                            &#8599;
                          </button>
                          <button
                            className="delete-mime-btn"
                            onClick={(e) => { e.stopPropagation(); handleDeleteCustom(m.id); }}
                            title="Delete"
                            data-testid={`delete-mime-${m.id}`}
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pet-grid add-cards-row">
                    <button className="pet-card add-card" onClick={() => setCreating("manual")}>
                      <div className="add-icon">+</div>
                      <span className="pet-name">Manual</span>
                    </button>
                    <button className="pet-card add-card" onClick={async () => {
                      const result = await open({
                        multiple: false,
                        filters: [{ name: "Sprite Sheet", extensions: ["png", "gif", "jpg", "jpeg"] }],
                      });
                      if (!result) return;
                      setSmartImportPath(result);
                      setCreating("smart");
                    }}>
                      <div className="add-icon">*</div>
                      <span className="pet-name">Import Sheet</span>
                    </button>
                    <button
                      className="pet-card add-card"
                      data-testid="import-animime-btn"
                      onClick={async () => {
                        setImportError(null);
                        try {
                          const id = await importMime();
                          if (id) setPet(id);
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : String(err);
                          logError(`[settings] import failed: ${msg}`);
                          setImportError(msg);
                        }
                      }}
                    >
                      <div className="add-icon">&#8598;</div>
                      <span className="pet-name">Animime</span>
                    </button>
                  </div>
                  {importError && (
                    <div className="save-error" data-testid="import-error">
                      Import failed: {importError}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
        {tab === "claude" && (
          <>
            {claude.loading && <div className="claude-empty-state">Loading Claude Code configuration...</div>}
            {claude.error && <div className="claude-empty-state claude-error">Failed to load: {claude.error}</div>}
            {claude.config && (
              <>
                {/* Plugins */}
                <div className="settings-section">
                  <div className="settings-section-title">Plugins</div>
                  {claude.config.plugins.length === 0 ? (
                    <div className="claude-empty-state">No plugins installed</div>
                  ) : (
                    <div className="settings-card">
                      {claude.config.plugins.map((p) => (
                        <div key={p.id} data-testid={`plugin-row-${p.id}`}>
                          <div className="settings-row">
                            <div className="claude-item-info">
                              <span className="settings-row-label">{p.name}</span>
                              <span className="claude-version-badge">v{p.version}</span>
                              <span className="claude-cmd-preview">{p.marketplace}</span>
                            </div>
                            <button
                              data-testid={`plugin-toggle-${p.id}`}
                              className={`toggle-switch ${p.enabled ? "active" : ""}`}
                              onClick={() => claude.setPluginEnabled(p.id, !p.enabled)}
                            >
                              <span className="toggle-knob" />
                            </button>
                          </div>
                          {/* TEMP: hide plugin skills expand toggle
                          {p.skills.length > 0 && (
                            <div className="claude-plugin-skills-section">
                              <button
                                className="claude-skills-toggle"
                                onClick={() => setExpandedPluginSkills((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                              >
                                <span className="claude-skills-toggle-arrow">{expandedPluginSkills[p.id] ? "\u25BE" : "\u25B8"}</span>
                                {p.skills.length} skill{p.skills.length !== 1 ? "s" : ""}
                              </button>
                              {expandedPluginSkills[p.id] && (
                                <div className="claude-plugin-skills">
                                  {p.skills.map((s) => (
                                    <span key={s} className="claude-skill-tag">{s}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          */}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* MCP Servers */}
                <div className="settings-section">
                  <div className="settings-section-title">MCP Servers</div>
                  {claude.config.global_mcp_servers.length === 0 && claude.config.project_mcp_servers.length === 0 ? (
                    <div className="claude-empty-state">No MCP servers registered</div>
                  ) : (
                    <>
                      {claude.config.global_mcp_servers.length > 0 && (
                        <div className="settings-card">
                          <div className="claude-sub-header">Global</div>
                          {claude.config.global_mcp_servers.map((s) => (
                            <div key={s.name} className="settings-row" data-testid={`mcp-global-${s.name}`}>
                              <div className="claude-item-info">
                                <span className="settings-row-label">{s.name}</span>
                                <span className="claude-cmd-preview">{s.command} {s.args.join(" ")}</span>
                              </div>
                              <button
                                className="claude-delete-btn"
                                title="Remove MCP server"
                                onClick={() => claude.deleteMcpServer(s.name)}
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {claude.config.project_mcp_servers.map((proj) => (
                        <div key={proj.project_path} className="settings-card" style={{ marginTop: 8 }}>
                          <div className="claude-sub-header">
                            <span className="claude-badge">project</span>
                            {proj.project_path.split("/").slice(-2).join("/")}
                          </div>
                          {proj.servers.map((s) => (
                            <div key={s.name} className="settings-row" data-testid={`mcp-project-${s.name}`}>
                              <div className="claude-item-info">
                                <span className="settings-row-label">{s.name}</span>
                                <span className="claude-cmd-preview">{s.command} {s.args.join(" ")}</span>
                              </div>
                              <button
                                className="claude-delete-btn"
                                title="Remove MCP server"
                                onClick={() => claude.deleteMcpServer(s.name, proj.project_path)}
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* Commands */}
                <div className="settings-section">
                  <div className="settings-section-title">Commands</div>
                  {claude.config.commands.length === 0 ? (
                    <div className="claude-empty-state">No custom commands</div>
                  ) : (
                    <div className="settings-card">
                      {claude.config.commands.map((cmd) => (
                        <div key={cmd.name} data-testid={`command-row-${cmd.name}`}>
                          <div className="settings-row">
                            <div className="claude-item-info">
                              <span className="settings-row-label">/{cmd.name}</span>
                              <span className="claude-cmd-preview">{cmd.file_name}</span>
                            </div>
                            <div className="claude-row-actions">
                              <button
                                className="claude-action-btn"
                                onClick={async () => {
                                  if (expandedCommand === cmd.name) {
                                    setExpandedCommand(null);
                                  } else {
                                    if (!commandContent[cmd.name]) {
                                      try {
                                        const content = await claude.getCommandContent(cmd.name);
                                        setCommandContent((prev) => ({ ...prev, [cmd.name]: content }));
                                      } catch {
                                        setCommandContent((prev) => ({ ...prev, [cmd.name]: "(failed to load)" }));
                                      }
                                    }
                                    setExpandedCommand(cmd.name);
                                  }
                                }}
                              >
                                {expandedCommand === cmd.name ? "Hide" : "View"}
                              </button>
                              <button
                                className="claude-delete-btn"
                                title="Delete command"
                                onClick={() => claude.deleteCommand(cmd.name)}
                              >
                                &times;
                              </button>
                            </div>
                          </div>
                          {expandedCommand === cmd.name && commandContent[cmd.name] && (
                            <pre className="claude-command-preview">{commandContent[cmd.name]}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Standalone Skills */}
                {claude.config.skills.length > 0 && (
                  <div className="settings-section">
                    <div className="settings-section-title">Standalone Skills</div>
                    <div className="settings-card claude-skills-list">
                      {claude.config.skills.map((skill) => (
                        <div key={skill.name} className="claude-skill-item" data-testid={`skill-row-${skill.name}`}>
                          <span className="settings-row-label">{skill.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hooks */}
                <div className="settings-section">
                  <div className="settings-section-title">Hooks</div>
                  {claude.config.hooks.length === 0 ? (
                    <div className="claude-empty-state">No hooks configured</div>
                  ) : (
                    <div className="settings-card">
                      {claude.config.hooks.map((evt) => (
                        <div key={evt.event}>
                          <div className="claude-hook-header">{evt.event}</div>
                          {evt.entries.map((entry, idx) => {
                            const isAniMime = entry.hooks.some((h) => h.command.includes("127.0.0.1:1234"));
                            return (
                              <div key={idx} className="settings-row claude-hook-row" data-testid={`hook-${evt.event}-${idx}`}>
                                <div className="claude-item-info">
                                  {isAniMime && <span className="claude-badge claude-badge-ani">ani-mime</span>}
                                  {entry.matcher && <span className="claude-badge">{entry.matcher}</span>}
                                  <span className="claude-cmd-preview">
                                    {entry.hooks.map((h) => h.command).join("; ").slice(0, 80)}
                                    {entry.hooks.map((h) => h.command).join("; ").length > 80 ? "..." : ""}
                                  </span>
                                </div>
                                {!isAniMime && (
                                  <button
                                    className="claude-delete-btn"
                                    title="Remove hook"
                                    onClick={() => claude.deleteHookEntry(evt.event, idx)}
                                  >
                                    &times;
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {tab === "about" && (
          <div className="settings-section">
            <div className="settings-card">
              <div className="about-info">
                <div className="about-name">Ani-Mime</div>
                <div
                  className={`about-version ${devMode ? "dev-active" : ""}`}
                  onClick={handleVersionClick}
                  style={{ userSelect: "none" }}
                >
                  Version 0.17.1{devMode && " (Dev Mode)"}
                </div>
                <div className="about-desc">A floating macOS desktop mascot that reacts to terminal and Claude Code activity in real-time.</div>
              </div>
            </div>
            <div className="settings-card" style={{ marginTop: 12 }}>
              <div className="settings-row">
                <div>
                  <div className="about-label">Author</div>
                  <div className="about-value">vietnguyenhoangw</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="about-label">Twitter</div>
                  <a
                    className="about-link"
                    href="https://x.com/vietnguyenw"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @vietnguyenw
                  </a>
                </div>
              </div>
            </div>
            <div className="settings-card" style={{ marginTop: 12 }}>
              <div className="about-info">
                <div className="about-label">Contributors</div>
                <div className="about-desc" style={{ marginBottom: 8 }}>Ani-Mime wouldn't be the same without these wonderful people. Thank you for your time, ideas, and code — you made this project better.</div>
                <div className="contributors">
                  {[
                    { login: "thnh-dng", avatar: "https://avatars.githubusercontent.com/u/213000297?v=4" },
                    { login: "yanmad27", avatar: "https://avatars.githubusercontent.com/u/38394675?v=4" },
                    { login: "thanh-dong", avatar: "https://avatars.githubusercontent.com/u/15724923?v=4" },
                    { login: "setnsail", avatar: "https://avatars.githubusercontent.com/u/213003653?v=4" },
                    { login: "QuangHo0911", avatar: "https://avatars.githubusercontent.com/u/207322672?v=4" },
                    { login: "cuongtranba", avatar: "https://avatars.githubusercontent.com/u/4550606?v=4" },
                  ].map((c) => (
                    <a
                      key={c.login}
                      className="contributor"
                      href={`https://github.com/${c.login}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img className="contributor-avatar" src={c.avatar} alt={c.login} />
                      <span className="contributor-name">{c.login}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {manualAnimPreview && (
          <AnimationPreview
            spriteUrl={manualAnimPreview.url}
            frames={manualAnimPreview.frames}
            label={manualAnimPreview.label}
            onClose={() => {
              URL.revokeObjectURL(manualAnimPreview.url);
              setManualAnimPreview(null);
            }}
          />
        )}
      </main>
    </div>
  );
}

function EffectToggle({ effectId, name }: { effectId: string; name: string }) {
  const { enabled, setEnabled } = useEffectEnabled(effectId);
  return (
    <div className="settings-row">
      <span className="settings-row-label">{name}</span>
      <button
        data-testid={`effect-toggle-${effectId}`}
        className={`toggle-switch ${enabled ? "active" : ""}`}
        onClick={() => setEnabled(!enabled)}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}
