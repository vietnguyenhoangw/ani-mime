import { useState, useEffect } from "react";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Status } from "../types/status";
import type { Orientation, Edge } from "../utils/snap";
import { inwardPopoverPos } from "../utils/popoverPos";
import { useSessionList } from "../hooks/useSessionList";
import { useLanList } from "../hooks/useLanList";
import { usePeers } from "../hooks/usePeers";
import { useSoundSettings } from "../hooks/useSoundSettings";
import { playAudio } from "../utils/audio";
import "../styles/mini-bar.css";
import "../styles/status-pill.css";

/** Tool-window sizes — must match the window defs in tauri.conf.json. */
const PEER_W = 280;
const PEER_H = 260;
const SESSION_W = 280;
const SESSION_H = 360;
const POPOVER_GAP = 8;

interface MiniBarProps {
  status: Status;
  orientation: Orientation;
  edge: Edge;
  /** mousedown on the grip — starts the drag. */
  onGripMouseDown: (e: React.MouseEvent) => void;
  onRestore: () => void;
}

/**
 * The collapsed mini bar. In mini mode each tool (session list, peers) opens
 * its OWN window docked inward from the bar — never an inline list/panel. (Pet
 * mode keeps the inline dropdown in StatusPill.)
 */
export function MiniBar({ status, orientation, edge, onGripMouseDown, onRestore }: MiniBarProps) {
  const { enabled: sessionListEnabled } = useSessionList();
  const { enabled: lanListEnabled } = useLanList();
  // Mirrors StatusPill: the peer tool is unavailable while visiting (you can't
  // start a second visit). The session list stays available.
  const peerDisabled = status === "visiting";
  const peers = usePeers();
  const [sessionOpen, setSessionOpen] = useState(false);
  const [peerOpen, setPeerOpen] = useState(false);

  // UI click feedback, gated by the master sound toggle — same as StatusPill.
  const soundSettings = useSoundSettings();
  const playClickTap = () => {
    if (soundSettings.master) playAudio("tap");
  };

  const hideToolWindow = async (label: string) => {
    const win = await WebviewWindow.getByLabel(label);
    await win?.hide().catch(() => {});
  };

  /** Show a tool window docked inward from the bar's snapped edge. */
  const showToolWindow = async (label: string, w: number, h: number) => {
    const win = await WebviewWindow.getByLabel(label);
    if (!win) return false;
    const main = getCurrentWindow();
    const sf = await main.scaleFactor();
    const pos = (await main.outerPosition()).toLogical(sf);
    const size = (await main.outerSize()).toLogical(sf);
    const p = inwardPopoverPos(
      { x: pos.x, y: pos.y, width: size.width, height: size.height },
      edge,
      w,
      h,
      POPOVER_GAP
    );
    await win.setPosition(new LogicalPosition(p.x, p.y));
    await win.show();
    await win.setFocus();
    return true;
  };

  const toggleSession = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sessionListEnabled) return;
    playClickTap();
    const win = await WebviewWindow.getByLabel("session-list");
    if (win && (await win.isVisible())) {
      await win.hide();
      setSessionOpen(false);
      return;
    }
    // Only one tool window open at a time.
    if (peerOpen) {
      await hideToolWindow("peer-list");
      setPeerOpen(false);
    }
    if (await showToolWindow("session-list", SESSION_W, SESSION_H)) {
      setSessionOpen(true);
    }
  };

  const togglePeer = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!lanListEnabled || peerDisabled) return;
    playClickTap();
    const win = await WebviewWindow.getByLabel("peer-list");
    if (win && (await win.isVisible())) {
      await win.hide();
      setPeerOpen(false);
      return;
    }
    if (sessionOpen) {
      await hideToolWindow("session-list");
      setSessionOpen(false);
    }
    if (await showToolWindow("peer-list", PEER_W, PEER_H)) {
      setPeerOpen(true);
    }
  };

  // Hide the peer window when the LAN list is turned off or while visiting.
  useEffect(() => {
    if (lanListEnabled && !peerDisabled) return;
    void hideToolWindow("peer-list");
    setPeerOpen(false);
  }, [lanListEnabled, peerDisabled]);

  // Reset a tool button's active highlight when its window loses focus (the
  // window hides itself on blur; this just keeps the button state in sync).
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    void (async () => {
      const peer = await WebviewWindow.getByLabel("peer-list");
      if (peer) {
        unsubs.push(
          await peer.onFocusChanged(({ payload }) => {
            if (!payload) setPeerOpen(false);
          })
        );
      }
      const sess = await WebviewWindow.getByLabel("session-list");
      if (sess) {
        unsubs.push(
          await sess.onFocusChanged(({ payload }) => {
            if (!payload) setSessionOpen(false);
          })
        );
      }
    })();
    return () => unsubs.forEach((fn) => fn());
  }, []);

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
    </div>
  );
}
