import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit } from "@tauri-apps/api/event";
import { useTheme, type Theme } from "../hooks/useTheme";
import { usePet } from "../hooks/usePet";
import { useBubble } from "../hooks/useBubble";
import { useGlow, type GlowMode } from "../hooks/useGlow";
import { useNickname } from "../hooks/useNickname";
import { mimeCategories, getMimesByCategory } from "../constants/sprites";
import { useCustomMimes, ALL_STATUSES } from "../hooks/useCustomMimes";
import { SmartImport } from "./SmartImport";
import type { Status } from "../types/status";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import "../styles/settings.css";

type Tab = "general" | "mime" | "about";

const tabTitles: Record<Tab, string> = {
  general: "General",
  mime: "Mime",
  about: "About",
};

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { pet, setPet } = usePet();
  const { enabled: bubbleEnabled, setEnabled: setBubbleEnabled } = useBubble();
  const { mode: glowMode, setMode: setGlowMode } = useGlow();
  const { nickname, setNickname } = useNickname();
  const { mimes: customMimes, pickSpriteFile, addMime, addMimeFromBlobs, deleteMime } = useCustomMimes();
  const [tab, setTab] = useState<Tab>("general");
  const [creating, setCreating] = useState<false | "manual" | "smart">(false);
  const [newName, setNewName] = useState("");
  const [spriteInputs, setSpriteInputs] = useState<
    Record<Status, { path: string; frames: number }>
  >(() => {
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = { path: "", frames: 1 };
    return init;
  });
  const [customPreviews, setCustomPreviews] = useState<Record<string, string>>({});
  const [draftNickname, setDraftNickname] = useState(nickname);
  const nicknameChanged = draftNickname !== nickname;

  useEffect(() => {
    setDraftNickname(nickname);
  }, [nickname]);
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
    if (devMode) return;

    clickCountRef.current += 1;
    clearTimeout(clickTimerRef.current);

    if (clickCountRef.current >= 10) {
      clickCountRef.current = 0;
      setDevMode(true);
      await emit("dev-mode-changed", true);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 3000);
    }
  };

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

  return (
    <div className="settings">
      <nav className="settings-sidebar">
        {(["general", "mime", "about"] as Tab[]).map((t) => (
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
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Behavior</div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Speech Bubbles</span>
                <button
                  className={`toggle-switch ${bubbleEnabled ? "active" : ""}`}
                  onClick={() => setBubbleEnabled(!bubbleEnabled)}
                >
                  <span className="toggle-knob" />
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
              <div className="settings-section-title">Custom</div>
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
              ) : creating === "smart" ? (
                <SmartImport
                  onSave={async (mimeName, blobs) => {
                    const id = await addMimeFromBlobs(mimeName, blobs);
                    setPet(id);
                    setCreating(false);
                  }}
                  onCancel={handleCancelCreate}
                />
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
                  <button className="pet-card add-card" onClick={() => setCreating("manual")}>
                    <div className="add-icon">+</div>
                    <span className="pet-name">Manual</span>
                  </button>
                  <button className="pet-card add-card" onClick={() => setCreating("smart")}>
                    <div className="add-icon">*</div>
                    <span className="pet-name">Import</span>
                  </button>
                </div>
              )}
            </div>
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
                  Version 0.14.12{devMode && " (Dev Mode)"}
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
      </main>
    </div>
  );
}
