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
import { useCollapsedSessionGroups } from "../hooks/useCollapsedSessionGroups";
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
  onRestore: () => void;
}

export function MiniBar({ status, orientation, edge, snapToNearest, onRestore }: MiniBarProps) {
  const didMountRef = useRef(false);

  const { enabled: sessionListEnabled } = useSessionList();
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();
  const [sessionOpen, setSessionOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  const toggleSession = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sessionListEnabled) return;
    if (sessionOpen) {
      setSessionOpen(false);
      return;
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
      if (didMountRef.current) snapToNearest();
      didMountRef.current = true;
      return;
    }
    didMountRef.current = true;
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

  const togglePeer = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const popover = await WebviewWindow.getByLabel("peer-list");
    if (!popover) return;
    if (await popover.isVisible()) {
      await popover.hide();
      return;
    }
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
          className="mini-bar-btn"
          aria-label="Show sessions list"
          aria-expanded={sessionOpen}
          title="Session list"
          onClick={toggleSession}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 9h10v2H7V9zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" />
          </svg>
        </button>
      )}

      <button
        type="button"
        data-testid="mini-bar-action-lan"
        className="mini-bar-btn"
        aria-label="Mime Around You"
        title="Peers nearby"
        onClick={togglePeer}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2v3H5a1 1 0 0 0-1 1v1h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H6v-1h12v1h-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1h-2v-1a1 1 0 0 0-1-1h-6V9h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H9z" />
        </svg>
      </button>

      <button
        type="button"
        data-testid="mini-bar-restore"
        className="mini-bar-btn"
        aria-label="Restore pet"
        title="Restore"
        onClick={onRestore}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4h7v2H6v5H4V4zm9 0h7v7h-2V6h-5V4zM4 13h2v5h5v2H4v-7zm14 0h2v7h-7v-2h5v-5z" />
        </svg>
      </button>

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
