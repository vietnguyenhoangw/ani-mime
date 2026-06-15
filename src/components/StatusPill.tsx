import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Status } from "../types/status";
import { fetchSessions } from "../hooks/useSessions";
import {
  groupSessions,
  detectHome,
  reflectActiveServices,
  overlayClaudeState,
  type Group,
} from "../utils/sessionGroups";
import { useSessionList } from "../hooks/useSessionList";
import { SessionDropdown } from "./SessionDropdown";
import { useSessionGroupCount } from "../hooks/useSessionGroupCount";
import { useLanList } from "../hooks/useLanList";
import { useOpacity } from "../hooks/useOpacity";
import { useCollapsedSessionGroups } from "../hooks/useCollapsedSessionGroups";
import { usePeers } from "../hooks/usePeers";
import { useSoundSettings } from "../hooks/useSoundSettings";
import { playAudio } from "../utils/audio";
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
  /**
   * When provided, renders a minimize button that collapses the pet into
   * mini-bar mode. Omitted in contexts where minimizing isn't allowed.
   */
  onMinimize?: () => void;
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

export function StatusPill({ status, glow, disabled = false, onOpenChange, onMinimize }: StatusPillProps) {
  // --- Session list state ---
  const [sessionOpen, setSessionOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [dropdownTop, setDropdownTop] = useState(0);
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState(280);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { enabled: sessionListEnabled } = useSessionList();
  const sessionCount = useSessionGroupCount(sessionListEnabled);
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();

  // --- Peer popover state ---
  const peers = usePeers();
  const { enabled: lanListEnabled } = useLanList();
  const { opacity: statusOpacity } = useOpacity("status");
  const [peerOpen, setPeerOpen] = useState(false);
  const lanButtonRef = useRef<HTMLButtonElement>(null);

  // UI click feedback — short tap on either pill button. Gated by the
  // master sound toggle so fully silencing the app silences these too.
  const soundSettings = useSoundSettings();
  const playClickTap = () => {
    if (soundSettings.master) playAudio("tap");
  };

  // --- Session-group path tooltip (portaled to body so the dropdown's
  // overflow:auto doesn't clip it when it renders above the first row). ---
  const [pathTooltip, setPathTooltip] = useState<{
    text: string;
    anchorX: number;
    anchorTop: number;
    anchorBottom: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

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

  // Position the tooltip after render so we can measure its actual size and
  // clamp it inside the window — paths are often wider than the dropdown,
  // which would otherwise leave the tooltip clipped by the window edge.
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
    playClickTap();
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

  // Live session refresh while dropdown is open. Event-driven via
  // `sessions-changed` (emitted by the backend only when the session set or
  // any UI-relevant field changes) — no polling.
  useEffect(() => {
    if (!sessionOpen) return;
    let cancelled = false;

    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      const overlaid = overlayClaudeState(reflectActiveServices(list));
      setGroups(groupSessions(overlaid, detectHome(overlaid)));
    };

    const unlistenP = listen("sessions-changed", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
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
    playClickTap();

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
              aria-label={`Show sessions list (${sessionCount})`}
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
              {sessionCount > 0 && (
                <span className="pill-action-badge" data-testid="pill-action-task-badge">
                  {sessionCount}
                </span>
              )}
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

          {onMinimize && (
            <button
              type="button"
              data-testid="pill-action-minimize"
              className="pill-action-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                playClickTap();
                onMinimize();
              }}
              aria-label="Minimize to bar"
              title="Minimize to bar"
            >
              <svg
                className="pill-action-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {sessionListEnabled && sessionOpen && (
        <SessionDropdown
          groups={groups}
          collapsed={collapsed}
          toggleCollapsed={(key) => void toggleCollapsed(key)}
          onPickSession={() => setSessionOpen(false)}
          style={{ top: `${dropdownTop}px`, maxHeight: `${dropdownMaxHeight}px` }}
          showPathTooltip={showPathTooltip}
          hidePathTooltip={hidePathTooltip}
        />
      )}

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
