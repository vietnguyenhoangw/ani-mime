import type { Status } from "../types/status";
import type { Orientation } from "../utils/snap";
import "../styles/mini-bar.css";

interface MiniBarProps {
  status: Status;
  orientation: Orientation;
  onRestore: () => void;
}

/**
 * The collapsed "mini bar" view. Reuses the `.dot` status classes from
 * status-pill.css (loaded globally because StatusPill is imported by App).
 * The status class on the root drives the glow color (see mini-bar.css).
 */
export function MiniBar({ status, orientation, onRestore }: MiniBarProps) {
  return (
    <div
      data-testid="mini-bar"
      data-orientation={orientation}
      className={`mini-bar ${orientation} ${status}`}
    >
      <span data-testid="mini-bar-dot" className={`dot ${status}`} />
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
