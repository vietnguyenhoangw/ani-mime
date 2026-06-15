import { useRef, useState, useEffect } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import type { Status } from "../types/status";
import type { Orientation, Edge } from "../utils/snap";
import { inwardPopoverPos } from "../utils/popoverPos";
import { fetchSessions } from "../hooks/useSessions";
import {
  groupSessions,
  detectHome,
  reflectActiveServices,
  overlayClaudeState,
  type Group,
} from "../utils/sessionGroups";
import { useSessionList } from "../hooks/useSessionList";
import { useLanList } from "../hooks/useLanList";
import { useCollapsedSessionGroups } from "../hooks/useCollapsedSessionGroups";
import { usePeers } from "../hooks/usePeers";
import { useSoundSettings } from "../hooks/useSoundSettings";
import { playAudio } from "../utils/audio";
import { SessionDropdown } from "./SessionDropdown";
import "../styles/mini-bar.css";
import "../styles/status-pill.css";

/** Peer-list popover window size — must match tauri.conf.json. */
const PEER_W = 280;
const PEER_H = 260;
const POPOVER_GAP = 8;

/** Mini-mode session panel size (logical px) when the list is open. */
const PANEL_W = 320;
const PANEL_LIST_H = 360;
const PANEL_HEADER_H = 40;

interface MiniBarProps {
  status: Status;
  orientation: Orientation;
  edge: Edge;
  snapToNearest: () => void;
  /** mousedown on the grip — starts the edge-constrained drag. */
  onGripMouseDown: (e: React.MouseEvent) => void;
  onRestore: () => void;
}

export function MiniBar({ status, orientation, edge, snapToNearest, onGripMouseDown, onRestore }: MiniBarProps) {
  // Tracks the session panel's previous open state so we only snap the bar
  // back when the panel actually closes — NOT on orientation changes, which
  // would otherwise interrupt the magnet glide mid-flight.
  const prevSessionOpenRef = useRef(false);

  const { enabled: sessionListEnabled } = useSessionList();
  const { enabled: lanListEnabled } = useLanList();
  // Mirrors StatusPill: the peer popover is unavailable while visiting
  // (you can't start a second visit). The session list stays available.
  const peerDisabled = status === "visiting";
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();
  const peers = usePeers();
  const [sessionOpen, setSessionOpen] = useState(false);
  const [peerOpen, setPeerOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  // UI click feedback, gated by the master sound toggle — same as StatusPill.
  const soundSettings = useSoundSettings();
  const playClickTap = () => {
    if (soundSettings.master) playAudio("tap");
  };

  const toggleSession = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sessionListEnabled) return;
    playClickTap();
    if (sessionOpen) {
      setSessionOpen(false);
      return;
    }
    // Only one popover at a time — hide the peer popover before opening.
    // Guarded so a popover lookup failure never blocks opening the list.
    try {
      const popover = await WebviewWindow.getByLabel("peer-list");
      if (popover && (await popover.isVisible())) {
        await popover.hide().catch(() => {});
        setPeerOpen(false);
      }
    } catch {
      /* peer window unavailable — ignore */
    }
    const list = await fetchSessions();
    setGroups(groupSessions(overlayClaudeState(reflectActiveServices(list)), detectHome(list)));
    setSessionOpen(true);
  };

  // Live refresh while open.
  useEffect(() => {
    if (!sessionOpen) return;
    let cancelled = false;
    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      setGroups(groupSessions(overlayClaudeState(reflectActiveServices(list)), detectHome(list)));
    };
    const unlistenP = listen("sessions-changed", () => void refresh());
    return () => {
      cancelled = true;
      unlistenP.then((fn) => fn());
    };
  }, [sessionOpen]);

  // Grow the bar window into a panel while the list is open.
  // On close, re-snap (which resizes the window back to the bar).
  useEffect(() => {
    if (!sessionOpen) {
      // Only restore the bar size when the panel was just open (panel→bar).
      // Orientation changes while closed come from a snap that already
      // positioned the bar, so don't re-snap here.
      if (prevSessionOpenRef.current) {
        prevSessionOpenRef.current = false;
        snapToNearest();
      }
      return;
    }
    prevSessionOpenRef.current = true;
    const vertical = orientation === "vertical";
    const w = PANEL_W;
    const h = vertical ? PANEL_LIST_H : PANEL_HEADER_H + PANEL_LIST_H;
    void (async () => {
      const win = getCurrentWindow();
      try {
        const sf = await win.scaleFactor();
        const pos = (await win.outerPosition()).toLogical(sf);
        let x = pos.x;
        let y = pos.y;
        const mon = await currentMonitor();
        if (mon) {
          const msf = mon.scaleFactor || 1;
          const mx = mon.position.x / msf;
          const my = mon.position.y / msf;
          const mw = mon.size.width / msf;
          const mh = mon.size.height / msf;
          // Clamp so the whole panel stays on-screen (expands inward
          // from whichever edge/corner the bar is snapped to).
          x = Math.min(Math.max(x, mx + 8), mx + mw - w - 8);
          y = Math.min(Math.max(y, my + 8), my + mh - h - 8);
        }
        await win.setSize(new LogicalSize(w, h));
        await win.setPosition(new LogicalPosition(x, y));
      } catch (err) {
        console.error("[mini-bar] panel grow failed:", err);
      }
    })();
  }, [sessionOpen, orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the peer popover hidden when the LAN list is turned off or while
  // visiting — mirrors StatusPill so the two modes behave identically.
  useEffect(() => {
    if (lanListEnabled && !peerDisabled) return;
    void (async () => {
      const popover = await WebviewWindow.getByLabel("peer-list");
      await popover?.hide().catch(() => {});
    })();
    setPeerOpen(false);
  }, [lanListEnabled, peerDisabled]);

  // Reset the active-state highlight when the popover loses focus (e.g. the
  // user clicks elsewhere) — same pattern as StatusPill.
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

  const togglePeer = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!lanListEnabled || peerDisabled) return;
    playClickTap();
    const popover = await WebviewWindow.getByLabel("peer-list");
    if (!popover) return;
    if (await popover.isVisible()) {
      await popover.hide();
      setPeerOpen(false);
      return;
    }
    // Only one popover at a time — close the session list before showing.
    if (sessionOpen) setSessionOpen(false);
    const main = getCurrentWindow();
    const sf = await main.scaleFactor();
    const pos = (await main.outerPosition()).toLogical(sf);
    const size = (await main.outerSize()).toLogical(sf);
    const p = inwardPopoverPos(
      { x: pos.x, y: pos.y, width: size.width, height: size.height },
      edge,
      PEER_W,
      PEER_H,
      POPOVER_GAP
    );
    await popover.setPosition(new LogicalPosition(p.x, p.y));
    await popover.show();
    await popover.setFocus();
    setPeerOpen(true);
  };

  return (
    <div
      data-testid="mini-bar"
      data-orientation={orientation}
      className={`mini-bar ${orientation} ${status}`}
    >
      <span data-testid="mini-bar-dot" className={`dot ${status}`} />

      {sessionListEnabled && (
        <button
          type="button"
          data-testid="mini-bar-action-task"
          className={`pill-action-btn ${sessionOpen ? "is-active" : ""}`}
          aria-label="Show sessions list"
          aria-expanded={sessionOpen}
          title="Session list"
          onClick={toggleSession}
        >
          <svg className="pill-action-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 9h10v2H7V9zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" />
          </svg>
        </button>
      )}

      {lanListEnabled && (
        <button
          type="button"
          data-testid="mini-bar-action-lan"
          className={`pill-action-btn ${peerOpen ? "is-active" : ""} ${peers.length > 0 ? "has-peers" : ""}`}
          aria-label="Mime Around You"
          aria-expanded={peerOpen}
          title="Peers nearby"
          onClick={togglePeer}
          disabled={peerDisabled}
        >
          <svg className="pill-action-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M9 2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2v3H5a1 1 0 0 0-1 1v1h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H6v-1h12v1h-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1h-2v-1a1 1 0 0 0-1-1h-6V9h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H9z" />
          </svg>
        </button>
      )}

      <button
        type="button"
        data-testid="mini-bar-restore"
        className="pill-action-btn"
        aria-label="Restore pet"
        title="Restore"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          playClickTap();
          onRestore();
        }}
      >
        <svg className="pill-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
        </svg>
      </button>

      <span
        data-testid="mini-bar-drag-handle"
        className="mini-bar-grip"
        role="separator"
        aria-label="Drag to move"
        title="Hold to move"
        onMouseDown={onGripMouseDown}
      >
        {/* Tight, flush 2×3 grip so its right edge hugs the bar edge the
            same ~8px as the status dot hugs the left. */}
        <svg width="5" height="11" viewBox="0 0 5 11" fill="currentColor" aria-hidden="true">
          <circle cx="1.1" cy="1.1" r="1.1" />
          <circle cx="3.9" cy="1.1" r="1.1" />
          <circle cx="1.1" cy="5.5" r="1.1" />
          <circle cx="3.9" cy="5.5" r="1.1" />
          <circle cx="1.1" cy="9.9" r="1.1" />
          <circle cx="3.9" cy="9.9" r="1.1" />
        </svg>
      </span>

      {sessionOpen && (
        <SessionDropdown
          groups={groups}
          collapsed={collapsed}
          toggleCollapsed={(key) => void toggleCollapsed(key)}
          onPickSession={() => setSessionOpen(false)}
          style={{ position: "static", transform: "none", left: "auto", maxHeight: `${PANEL_LIST_H}px`, width: "100%" }}
          showPathTooltip={() => {}}
          hidePathTooltip={() => {}}
        />
      )}
    </div>
  );
}
