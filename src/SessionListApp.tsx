import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetchSessions, type SessionInfo } from "./hooks/useSessions";
import { useCollapsedSessionGroups } from "./hooks/useCollapsedSessionGroups";
import { useWindowAutoSize } from "./hooks/useWindowAutoSize";
import { useQuickClose } from "./hooks/useQuickClose";
import "./styles/theme.css";
import "./styles/session-list-window.css";

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

function prettyPath(pwd: string, home?: string): string {
  if (!pwd) return "";
  if (home && pwd.startsWith(home)) return "~" + pwd.slice(home.length);
  return pwd;
}

function groupBasename(g: {
  pwd: string;
  pretty: string;
  sessions: SessionInfo[];
}): string {
  if (g.pwd) {
    const leaf = g.pwd.split("/").filter(Boolean).pop();
    if (leaf) return leaf;
  }
  return g.pretty || g.sessions[0]?.title || "";
}

function shellLabel(s: SessionInfo): string {
  if (s.has_claude) return "claude";
  if (s.fg_cmd) return s.fg_cmd.replace(/^-/, "");
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
    // Sort children by pid so refresh-induced HashMap reorders don't
    // shuffle rows under the cursor and break :hover.
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
      : s
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

export function SessionListApp() {
  useQuickClose();
  const rootRef = useRef<HTMLDivElement>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();
  const [pathTooltip, setPathTooltip] = useState<{
    text: string;
    anchorX: number;
    anchorTop: number;
    anchorBottom: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // This dialog is always light, regardless of the app theme.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);
  useWindowAutoSize(rootRef);

  // Refresh sessions on mount and whenever the backend fires
  // `sessions-changed` (fingerprint-gated emit). No polling.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      const overlaid = overlayClaudeState(reflectActiveServices(list));
      setGroups(groupSessions(overlaid, detectHome(overlaid)));
    };

    void refresh();

    const unlistenP = listen("sessions-changed", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unlistenP.then((fn) => fn());
    };
  }, []);

  // Hide on focus loss or Escape.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) void win.hide();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void win.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlistenP.then((fn) => fn());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const showPathTooltip = (el: HTMLElement, text: string) => {
    const rect = el.getBoundingClientRect();
    setPathTooltip({
      text,
      anchorX: rect.left + rect.width / 2,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
    });
  };
  const hidePathTooltip = () => setPathTooltip(null);

  // Measure the tooltip after render and clamp to the viewport so the full
  // path stays visible regardless of window width.
  useLayoutEffect(() => {
    if (!pathTooltip) return;
    const el = tooltipRef.current;
    if (!el) return;

    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const MARGIN = 8;
    const GAP = 6;
    const vw = window.innerWidth;

    const placeAbove = pathTooltip.anchorTop >= h + GAP + MARGIN;
    const y = placeAbove
      ? pathTooltip.anchorTop - h - GAP
      : pathTooltip.anchorBottom + GAP;

    let x = pathTooltip.anchorX - w / 2;
    x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));

    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.setProperty("--arrow-x", `${Math.round(pathTooltip.anchorX - x)}px`);
    el.classList.toggle("below", !placeAbove);
    el.style.visibility = "visible";
  }, [pathTooltip]);

  const onItemClick = (s: SessionInfo) => {
    invoke("focus_terminal", { pid: s.pid, tty: s.tty || null }).catch((err) =>
      console.error("[session-list] focus_terminal", err)
    );
    void getCurrentWindow().hide();
  };

  return (
    <div ref={rootRef} className="session-list-shell">
      <div
        className="session-list-root"
        data-testid="session-list-root"
        role="menu"
      >
        <header className="session-list-header">
          <div className="session-list-header-text">
            <h1>Sessions</h1>
            <p className="sub">Click a terminal to bring it to the front.</p>
          </div>
          <button
            type="button"
            className="session-list-close"
            data-testid="session-list-close"
            aria-label="Close"
            title="Close (⌘W)"
            onClick={() => void getCurrentWindow().hide()}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="session-list-body">
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
                  <span className="session-group-title">{groupBasename(g)}</span>
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
                          onItemClick(s);
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
      </div>

      {pathTooltip &&
        createPortal(
          <div
            ref={tooltipRef}
            className="session-path-tooltip"
            style={{ visibility: "hidden" }}
            role="tooltip"
          >
            {pathTooltip.text}
          </div>,
          document.body
        )}
    </div>
  );
}
