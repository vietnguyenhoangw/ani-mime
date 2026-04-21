import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Status } from "../types/status";
import { fetchSessions, type SessionInfo } from "../hooks/useSessions";
import { useSessionList } from "../hooks/useSessionList";
import { useLanList } from "../hooks/useLanList";
import { useOpacity } from "../hooks/useOpacity";
import { useCollapsedSessionGroups } from "../hooks/useCollapsedSessionGroups";
import { usePeers } from "../hooks/usePeers";
import "../styles/status-pill.css";

interface StatusPillProps {
  status: Status;
  glow?: boolean;
  /**
   * Disables the lan (peer) icon — used during a visit when the user
   * can't start a second one. The task icon (session list) is always
   * available regardless of visiting state.
   */
  disabled?: boolean;
  /**
   * Notifies parent when the session-list dropdown open state changes.
   * App uses this to pause window auto-size and manually grow the Tauri
   * window while the fixed-positioned dropdown is visible.
   */
  onOpenChange?: (open: boolean) => void;
}

const dotClassMap: Record<Status, string> = {
  service: "dot service",
  busy: "dot busy",
  idle: "dot idle",
  disconnected: "dot disconnected",
  initializing: "dot initializing",
  searching: "dot searching",
  visiting: "dot visiting",
};

const labelMap: Record<Status, string> = {
  service: "Service",
  busy: "Working...",
  idle: "Free",
  disconnected: "Sleep",
  initializing: "Initializing...",
  searching: "Searching...",
  visiting: "Visiting...",
};

// Priority for picking a group's summary state: busy > service > idle.
const statePriority: Record<string, number> = {
  busy: 3,
  service: 2,
  idle: 1,
};

function groupState(sessions: SessionInfo[]): string {
  let best = "idle";
  let bestP = 0;
  for (const s of sessions) {
    const p = statePriority[s.ui_state] ?? 0;
    if (p > bestP) {
      bestP = p;
      best = s.ui_state;
    }
  }
  return best;
}

/** Turn /Users/you/dev/foo into ~/dev/foo when home is known. */
function prettyPath(pwd: string, home?: string): string {
  if (!pwd) return "";
  if (home && pwd.startsWith(home)) return "~" + pwd.slice(home.length);
  return pwd;
}

/** Last path segment of a group (the leaf folder name). Falls back to the
 *  pretty path or a sensible string when pwd is missing. */
function groupBasename(g: { pwd: string; pretty: string; sessions: SessionInfo[] }): string {
  if (g.pwd) {
    const leaf = g.pwd.split("/").filter(Boolean).pop();
    if (leaf) return leaf;
  }
  return g.pretty || g.sessions[0]?.title || "";
}

/** Human-readable label for what's happening in a single shell. */
function shellLabel(s: SessionInfo): string {
  if (s.has_claude) return "claude";
  if (s.fg_cmd) {
    return s.fg_cmd.replace(/^-/, "");
  }
  if (s.ui_state === "busy" && s.busy_type) return s.busy_type;
  if (s.ui_state === "service") return "service";
  return "idle";
}

interface Group {
  key: string;
  pwd: string;
  pretty: string;
  sessions: SessionInfo[];
  state: string;
  isClaudeFallback: boolean;
}

function groupSessions(sessions: SessionInfo[], home?: string): Group[] {
  const claudeVirtual = sessions.find((s) => s.pid === 0);
  const anyShellHasClaude = sessions.some((s) => s.pid !== 0 && s.has_claude);

  const byKey = new Map<string, { pwd: string; list: SessionInfo[] }>();
  for (const s of sessions) {
    if (s.pid === 0) continue;
    if (s.is_claude_proc) continue;
    const key = s.pwd || s.title || String(s.pid);
    if (!byKey.has(key)) byKey.set(key, { pwd: s.pwd, list: [] });
    byKey.get(key)!.list.push(s);
  }

  const groups: Group[] = [];
  for (const [key, { pwd, list }] of byKey.entries()) {
    const pretty = pwd
      ? prettyPath(pwd, home)
      : list[0].title || `pid ${list[0].pid}`;
    // Sort children within a group by pid so row order stays stable
    // across refreshes. The backend returns sessions from a HashMap,
    // so iteration order can change between invocations — without this
    // sort, rows can swap under the cursor every 3s refresh and the
    // CSS :hover highlight flickers off the row you're hovering.
    list.sort((a, b) => a.pid - b.pid);
    groups.push({
      key,
      pwd,
      pretty,
      sessions: list,
      state: groupState(list),
      isClaudeFallback: false,
    });
  }

  groups.sort((a, b) => {
    const pa = statePriority[a.state] ?? 0;
    const pb = statePriority[b.state] ?? 0;
    if (pa !== pb) return pb - pa;
    return a.pretty.localeCompare(b.pretty);
  });

  if (claudeVirtual && !anyShellHasClaude) {
    groups.push({
      key: "claude-virtual",
      pwd: "",
      pretty: "Claude Code",
      sessions: [claudeVirtual],
      state: claudeVirtual.ui_state,
      isClaudeFallback: true,
    });
  }

  return groups;
}

function detectHome(sessions: SessionInfo[]): string | undefined {
  for (const s of sessions) {
    const m = s.pwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
    if (m) return m[1];
  }
  return undefined;
}

function reflectActiveServices(sessions: SessionInfo[]): SessionInfo[] {
  return sessions.map((s) =>
    s.busy_type === "service" && s.ui_state === "idle"
      ? { ...s, ui_state: "service" }
      : s,
  );
}

function overlayClaudeState(sessions: SessionInfo[]): SessionInfo[] {
  const sessionByPid = new Map<number, SessionInfo>();
  for (const s of sessions) sessionByPid.set(s.pid, s);

  return sessions.map((s) => {
    if (!s.has_claude) return s;
    const claudeSession =
      (s.claude_pid != null && sessionByPid.get(s.claude_pid)) ||
      sessionByPid.get(0);
    if (!claudeSession) return s;
    const claudeP = statePriority[claudeSession.ui_state] ?? 0;
    const ownP = statePriority[s.ui_state] ?? 0;
    return ownP >= claudeP ? s : { ...s, ui_state: claudeSession.ui_state };
  });
}

/** Width of the peer-list popover window — must match tauri.conf.json. */
const POPOVER_WIDTH = 280;
/** Negative offset overlaps the popover's 12px shadow-buffer padding. */
const POPOVER_TOP_GAP = -8;

async function computePopoverScreenPos(
  anchorEl: HTMLElement
): Promise<LogicalPosition> {
  const main = getCurrentWindow();
  const mainPos = await main.outerPosition();
  const scale = await main.scaleFactor();

  const pill = anchorEl.closest(".pill") ?? anchorEl;
  const rect = (pill as HTMLElement).getBoundingClientRect();

  const mainLogical =
    mainPos instanceof PhysicalPosition ? mainPos.toLogical(scale) : mainPos;

  const centerX = mainLogical.x + rect.left + rect.width / 2;
  const left = centerX - POPOVER_WIDTH / 2;
  const top = mainLogical.y + rect.bottom + POPOVER_TOP_GAP;
  return new LogicalPosition(Math.round(left), Math.round(top));
}

export function StatusPill({ status, glow, disabled = false, onOpenChange }: StatusPillProps) {
  // --- Session list state ---
  const [sessionOpen, setSessionOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [dropdownTop, setDropdownTop] = useState(0);
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState(280);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { enabled: sessionListEnabled } = useSessionList();
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();

  // --- Peer popover state ---
  const peers = usePeers();
  const { enabled: lanListEnabled } = useLanList();
  const { opacity: statusOpacity } = useOpacity("status");
  const [peerOpen, setPeerOpen] = useState(false);
  const lanButtonRef = useRef<HTMLButtonElement>(null);

  // --- Session-group path tooltip (portaled to body so the dropdown's
  // overflow:auto doesn't clip it when it renders above the first row). ---
  const [pathTooltip, setPathTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const showPathTooltip = (el: HTMLElement, text: string) => {
    const rect = el.getBoundingClientRect();
    setPathTooltip({
      text,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top),
    });
  };
  const hidePathTooltip = () => setPathTooltip(null);

  useEffect(() => {
    onOpenChange?.(sessionOpen);
  }, [sessionOpen, onOpenChange]);

  useEffect(() => {
    if (!sessionOpen) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 6;
    setDropdownTop(top);
    // The window grows to 400 tall when the session list opens (see
    // SESSION_DROPDOWN_WINDOW_HEIGHT in App.tsx). Cap the dropdown's
    // max-height so it fits between `top` and the window's bottom —
    // the 10px tail leaves room for the shadow buffer. overflow-y:auto
    // (in status-pill.css) scrolls when the list is taller.
    const SESSION_WINDOW_HEIGHT = 400;
    const BOTTOM_MARGIN = 10;
    setDropdownMaxHeight(
      Math.max(120, SESSION_WINDOW_HEIGHT - top - BOTTOM_MARGIN)
    );
  }, [sessionOpen]);

  const toggleSession = async (e: React.MouseEvent) => {
    if (!sessionListEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (sessionOpen) {
      setSessionOpen(false);
      return;
    }
    // Only one popover at a time — hide the peer popover before showing
    // the session dropdown.
    if (peerOpen) {
      const popover = await WebviewWindow.getByLabel("peer-list");
      await popover?.hide().catch(() => {});
      setPeerOpen(false);
    }
    const list = await fetchSessions();
    const overlaid = overlayClaudeState(reflectActiveServices(list));
    setGroups(groupSessions(overlaid, detectHome(overlaid)));
    setSessionOpen(true);
  };

  useEffect(() => {
    if (!sessionListEnabled && sessionOpen) setSessionOpen(false);
  }, [sessionListEnabled, sessionOpen]);

  // Live session refresh while dropdown is open.
  useEffect(() => {
    if (!sessionOpen) return;
    let cancelled = false;

    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      const overlaid = overlayClaudeState(reflectActiveServices(list));
      setGroups(groupSessions(overlaid, detectHome(overlaid)));
    };

    const unlistenP = listen("status-changed", () => {
      void refresh();
    });
    const id = setInterval(refresh, 3000);

    return () => {
      cancelled = true;
      clearInterval(id);
      unlistenP.then((fn) => fn());
    };
  }, [sessionOpen]);

  // Session dropdown closes ONLY on Escape, pill-toggle, or item click.
  useEffect(() => {
    if (!sessionOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSessionOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionOpen]);

  // --- Peer popover effects ---
  useEffect(() => {
    if (!disabled && lanListEnabled) return;
    void (async () => {
      const popover = await WebviewWindow.getByLabel("peer-list");
      await popover?.hide().catch(() => {});
    })();
    setPeerOpen(false);
  }, [disabled, lanListEnabled]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const popover = await WebviewWindow.getByLabel("peer-list");
      if (!popover) return;
      const fn = await popover.onFocusChanged(({ payload: focused }) => {
        if (!focused) setPeerOpen(false);
      });
      unlisten = fn;
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!peerOpen) return;
    const main = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      const popover = await WebviewWindow.getByLabel("peer-list");
      if (!popover || cancelled) return;
      const handler = async () => {
        if (!lanButtonRef.current) return;
        if (!(await popover.isVisible())) return;
        const pos = await computePopoverScreenPos(lanButtonRef.current);
        await popover.setPosition(pos).catch(() => {});
      };
      const fn = await main.onMoved(handler);
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [peerOpen]);

  const togglePeer = async (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (!lanButtonRef.current) return;

    const popover = await WebviewWindow.getByLabel("peer-list");
    if (!popover) {
      console.error("[status-pill] peer-list window not found");
      return;
    }

    const visible = await popover.isVisible();
    if (visible) {
      await popover.hide();
      setPeerOpen(false);
      return;
    }

    // Only one popover at a time — close the session dropdown before
    // showing the peer list.
    if (sessionOpen) setSessionOpen(false);

    const pos = await computePopoverScreenPos(lanButtonRef.current);
    await popover.setPosition(pos);
    await popover.show();
    await popover.setFocus();
    setPeerOpen(true);
  };

  const peerTooltip = disabled
    ? "Already visiting someone"
    : peers.length === 0
      ? "No peers nearby"
      : `${peers.length} peer${peers.length === 1 ? "" : "s"} nearby`;

  return (
    <div ref={wrapRef} className="pill-wrap" data-testid="status-pill-wrap" style={{ opacity: statusOpacity }}>
      <div
        data-testid="status-pill"
        className={`pill ${glow ? "neon-glow" : ""} ${status === "busy" ? "neon-busy" : ""} ${sessionOpen || peerOpen ? "is-open" : ""} ${!lanListEnabled ? "no-lan" : ""} ${!sessionListEnabled ? "no-tasks" : ""}`}
      >
        <span data-testid="status-dot" className={dotClassMap[status] ?? "dot searching"} />
        <span data-testid="status-label" className="label">
          {labelMap[status] ?? "Searching..."}
        </span>

        <div className="pill-actions" data-testid="pill-actions">
          {sessionListEnabled && (
            <button
              type="button"
              data-testid="pill-action-task"
              className={`pill-action-btn ${sessionOpen ? "is-active" : ""}`}
              onClick={toggleSession}
              aria-label="Show sessions list"
              aria-expanded={sessionOpen}
              title="Session list"
            >
              <svg
                className="pill-action-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 9h10v2H7V9zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" />
              </svg>
            </button>
          )}

          {lanListEnabled && (
          <button
            ref={lanButtonRef}
            type="button"
            data-testid="pill-action-lan"
            className={`pill-action-btn ${peerOpen ? "is-active" : ""} ${peers.length > 0 ? "has-peers" : ""}`}
            onClick={togglePeer}
            disabled={disabled}
            aria-label={`Mime Around You (${peers.length})`}
            aria-expanded={peerOpen}
            title={peerTooltip}
          >
            <svg
              className="pill-action-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M9 2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2v3H5a1 1 0 0 0-1 1v1h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H6v-1h12v1h-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1h-2v-1a1 1 0 0 0-1-1h-6V9h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H9z" />
            </svg>
            {peers.length > 0 && (
              <span className="pill-action-badge" data-testid="pill-action-lan-badge">
                {peers.length}
              </span>
            )}
          </button>
          )}
        </div>
      </div>

      {sessionListEnabled && sessionOpen && (
        <div
          data-testid="session-dropdown"
          className="session-dropdown"
          role="menu"
          style={{
            top: `${dropdownTop}px`,
            maxHeight: `${dropdownMaxHeight}px`,
          }}
        >
          {groups.length === 0 ? (
            <div className="session-empty">No active terminals</div>
          ) : (
            groups.map((g) => {
              const isCollapsed = collapsed.has(g.key);
              const headContent = (
                <>
                  {!g.isClaudeFallback && (
                    <span className="session-group-caret" aria-hidden="true" />
                  )}
                  <span className={`dot small ${g.state}`} />
                  <span className="session-group-title-row">
                    <span className="session-group-title">
                      {groupBasename(g)}
                    </span>
                    {g.pretty && g.pretty !== groupBasename(g) && (
                      <span
                        className="session-group-info"
                        aria-label={`Full path: ${g.pretty}`}
                        onMouseEnter={(e) =>
                          showPathTooltip(e.currentTarget, g.pretty)
                        }
                        onMouseLeave={hidePathTooltip}
                      >
                        ?
                      </span>
                    )}
                  </span>
                  {g.sessions.length > 1 && (
                    <span className="session-count">{g.sessions.length}</span>
                  )}
                </>
              );
              return (
                <div
                  key={g.key}
                  className={`session-group ${g.isClaudeFallback ? "claude" : ""}`}
                  data-testid={`session-group-${g.key}`}
                >
                  {g.isClaudeFallback ? (
                    <div className="session-group-head">{headContent}</div>
                  ) : (
                    <button
                      type="button"
                      className={`session-group-head clickable ${isCollapsed ? "collapsed" : ""}`}
                      data-testid={`session-group-head-${g.key}`}
                      aria-expanded={!isCollapsed}
                      aria-controls={`session-children-${g.key}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleCollapsed(g.key);
                      }}
                    >
                      {headContent}
                    </button>
                  )}

                  {!g.isClaudeFallback && !isCollapsed && (
                    <div
                      className="session-children"
                      id={`session-children-${g.key}`}
                    >
                      {g.sessions.map((s) => (
                        <button
                          key={s.pid}
                          type="button"
                          className={`session-child ${s.has_claude ? "has-claude" : ""}`}
                          data-testid={`session-item-${s.pid}`}
                          title="Click to bring this terminal to the front"
                          onClick={(e) => {
                            e.stopPropagation();
                            invoke("focus_terminal", { pid: s.pid, tty: s.tty || null })
                              .catch((err) => console.error("[focus_terminal]", err));
                            setSessionOpen(false);
                          }}
                        >
                          <span className={`dot small ${s.ui_state}`} />
                          <span className="session-child-label-row">
                            <span className="session-child-label">{shellLabel(s)}</span>
                            {s.has_claude && (
                              <span
                                className="session-child-claude"
                                aria-label="Claude Code running"
                              />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {pathTooltip &&
        createPortal(
          <div
            className="session-path-tooltip"
            style={{ left: pathTooltip.x, top: pathTooltip.y }}
            role="tooltip"
          >
            {pathTooltip.text}
          </div>,
          document.body
        )}
    </div>
  );
}
