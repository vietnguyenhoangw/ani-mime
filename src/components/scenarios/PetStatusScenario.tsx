import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Status } from "../../types/status";

const statuses: { status: Status; label: string; desc: string; color: string; bubble?: string }[] = [
  { status: "idle", label: "Free", desc: "No active tasks", color: "#34c759" },
  { status: "busy", label: "Working", desc: "Running a command", color: "#ff3b30" },
  { status: "service", label: "Service", desc: "Brief service event", color: "#5e5ce6" },
  { status: "disconnected", label: "Sleep", desc: "Idle timeout / no sessions", color: "#636366" },
  { status: "initializing", label: "Initializing", desc: "App starting up", color: "#ff9f0a" },
  { status: "searching", label: "Searching", desc: "Looking for shell sessions", color: "#ffcc00" },
  { status: "visiting", label: "Visiting", desc: "Dog visiting a peer", color: "#af52de" },
  { status: "idle", label: "Free + Bubble", desc: "Idle with short bubble", color: "#30d158", bubble: "Task complete!" },
  { status: "idle", label: "Long Bubble", desc: "Test long text overflow", color: "#30d158", bubble: "Hey! Your build finished successfully after 42 seconds. Everything looks good!" },
  { status: "idle", label: "Ultra Long Bubble", desc: "Test very long text overflow (2x long)", color: "#30d158", bubble: "Hey! Your build finished successfully after 42 seconds. Everything looks good! I also ran the full test suite, linted every file, and updated the changelog." },
];

export function PetStatusScenario() {
  const [active, setActive] = useState<string | null>(null);

  const handleClick = (label: string, status: Status, bubble?: string) => {
    setActive(label);
    invoke("scenario_override", { status });
    if (bubble) {
      invoke("preview_dialog", { dialogId: `bubble_persist:${bubble}` });
    }
  };

  return (
    <div className="scenario-panel">
      <div className="scenario-panel-desc">
        Click a status to preview it on the mascot in real-time.
      </div>
      <div className="scenario-status-grid">
        {statuses.map(({ status, label, desc, color, bubble }) => (
          <button
            key={label}
            className={`scenario-status-btn ${active === label ? "active" : ""}`}
            onClick={() => handleClick(label, status, bubble)}
          >
            <div className="scenario-status-title">
              <span className="scenario-status-dot" style={{ background: color }} />
              <span className="scenario-status-label">{label}</span>
            </div>
            <span className="scenario-status-desc">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
