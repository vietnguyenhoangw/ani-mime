import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DialogItem {
  id: string;
  label: string;
  desc: string;
  type: "native" | "bubble";
}

interface DialogCategory {
  title: string;
  items: DialogItem[];
}

const categories: DialogCategory[] = [
  {
    title: "Update Dialogs",
    items: [
      {
        id: "update_available",
        label: "Update Available",
        desc: "Later / Changelog / Update Now",
        type: "native",
      },
      {
        id: "update_up_to_date",
        label: "Up to Date",
        desc: "Already on latest version",
        type: "native",
      },
      {
        id: "update_failed",
        label: "Update Failed",
        desc: "Could not reach GitHub",
        type: "native",
      },
    ],
  },
  {
    title: "Setup Dialogs",
    items: [
      {
        id: "setup_shell_single",
        label: "Shell Setup (Single)",
        desc: "Single shell detected — Yes / Skip",
        type: "native",
      },
      {
        id: "setup_shell_multiple",
        label: "Shell Setup (Multiple)",
        desc: "Choose from list dialog",
        type: "native",
      },
      {
        id: "setup_claude",
        label: "Claude Code Setup",
        desc: "Enable Claude hooks — Yes / Skip",
        type: "native",
      },
      {
        id: "setup_complete",
        label: "Setup Complete",
        desc: "Success confirmation",
        type: "native",
      },
      {
        id: "setup_no_shells",
        label: "No Shells Found",
        desc: "No supported shell installed",
        type: "native",
      },
      {
        id: "setup_no_selected",
        label: "No Shell Selected",
        desc: "User skipped all shells",
        type: "native",
      },
    ],
  },
  {
    title: "Speech Bubbles",
    items: [
      {
        id: "bubble_welcome",
        label: "Welcome",
        desc: "First idle greeting message",
        type: "bubble",
      },
      {
        id: "bubble_task_completed",
        label: "Task Completed",
        desc: "Random completion message",
        type: "bubble",
      },
      {
        id: "bubble_discovery_hint",
        label: "Discovery Hint",
        desc: "No peers found — check Local Network",
        type: "bubble",
      },
    ],
  },
];

export function DialogPreviewScenario() {
  const [active, setActive] = useState<string | null>(null);

  const handleClick = (id: string) => {
    setActive(id);
    invoke("preview_dialog", { dialogId: id });
  };

  return (
    <div className="scenario-panel">
      <div className="scenario-panel-desc">
        Click a dialog to preview it. Native dialogs open as macOS alerts (safe,
        no side effects). Speech bubbles appear on the mascot.
      </div>
      {categories.map((cat) => (
        <div key={cat.title} className="dialog-category">
          <div className="dialog-category-title">{cat.title}</div>
          <div className="dialog-preview-grid">
            {cat.items.map(({ id, label, desc, type }) => (
              <button
                key={id}
                className={`scenario-status-btn ${active === id ? "active" : ""}`}
                onClick={() => handleClick(id)}
              >
                <div className="scenario-status-title">
                  <span
                    className="scenario-status-dot"
                    style={{
                      background: type === "native" ? "#5e5ce6" : "#34c759",
                    }}
                  />
                  <span className="scenario-status-label">{label}</span>
                </div>
                <span className="scenario-status-desc">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
