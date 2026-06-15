import { useRef } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Status } from "../types/status";
import type { Orientation, Edge } from "../utils/snap";
import { inwardPopoverPos } from "../utils/popoverPos";
import "../styles/mini-bar.css";

/** Peer-list popover window size — must match tauri.conf.json. */
const PEER_W = 280;
const PEER_H = 260;
const POPOVER_GAP = 8;

interface MiniBarProps {
  status: Status;
  orientation: Orientation;
  edge: Edge;
  onRestore: () => void;
}

export function MiniBar({ status, orientation, edge, onRestore }: MiniBarProps) {
  const lanButtonRef = useRef<HTMLButtonElement>(null);

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

      <button
        ref={lanButtonRef}
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
    </div>
  );
}
