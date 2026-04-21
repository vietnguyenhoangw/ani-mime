import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useTheme } from "../hooks/useTheme";
import { ScenarioViewer } from "./scenarios";
import "../styles/theme.css";
import "../styles/superpower.css";

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

type LogFilter = "all" | "info" | "debug" | "warn" | "error";
type MenuItem = "logs" | "scenarios";

function formatTime(timestamp: string): string {
  const parts = timestamp.split(" ");
  return parts.length > 1 ? parts[1] : timestamp;
}

const tagColorMap: Record<string, string> = {
  http: "#5e5ce6",
  visit: "#af52de",
  discovery: "#007aff",
  watchdog: "#ff9f0a",
  setup: "#34c759",
  app: "#5ac8fa",
  state: "#64d2ff",
  platform: "#636366",
};

function LogTag({ tag }: { tag: string }) {
  const color = tagColorMap[tag] || "#636366";
  return <span className="log-tag" style={{ color }}>{tag}</span>;
}

function LogLevel({ level }: { level: string }) {
  if (level === "info") return null;
  return <span className={`log-level log-level-${level}`}>{level.toUpperCase()}</span>;
}

function parseLogTag(message: string, source: string): { tag: string; rest: string } {
  const match = message.match(/^\[(\w+)]\s*(.*)/);
  if (match) return { tag: match[1], rest: match[2] };
  const modName = source.split("::").pop() || source;
  return { tag: modName, rest: message };
}

function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const entries = await invoke<LogEntry[]>("get_logs");
      setLogs(entries);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 1000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const filtered = logs.filter((entry) => {
    if (filter !== "all" && entry.level !== filter) return false;
    if (search && !entry.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const handleClear = async () => {
    await invoke("clear_logs");
    setLogs([]);
  };

  const handleOpenDir = () => {
    invoke("open_log_dir");
  };

  const warnCount = logs.filter((l) => l.level === "warn").length;
  const errorCount = logs.filter((l) => l.level === "error").length;

  return (
    <div className="log-viewer">
      <div className="log-toolbar">
        <span className="log-toolbar-title">Logs</span>
        <div className="log-toolbar-actions">
          <input
            className="log-search"
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="log-filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as LogFilter)}
            data-testid="log-filter-select"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
            <option value="warn">{`Warn${warnCount > 0 ? ` (${warnCount})` : ""}`}</option>
            <option value="error">{`Error${errorCount > 0 ? ` (${errorCount})` : ""}`}</option>
          </select>
          <span className="log-count">{filtered.length}/{logs.length}</span>
          <button className="log-btn" onClick={handleOpenDir} data-testid="log-open-dir-btn">Reveal in Finder</button>
          <button className="log-btn" onClick={handleClear} data-testid="log-clear-btn">Clear</button>
        </div>
      </div>
      <div
        className="log-container"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {filtered.length === 0 && (
          <div className="log-empty">
            {logs.length === 0
              ? "No logs yet. Activity will appear here."
              : "No logs match the current filter."}
          </div>
        )}
        {filtered.map((entry, i) => {
          const { tag, rest } = parseLogTag(entry.message, entry.source);
          return (
            <div key={i} className={`log-entry log-entry-${entry.level}`}>
              <span className="log-time">{formatTime(entry.timestamp)}</span>
              <LogLevel level={entry.level} />
              {tag && <LogTag tag={tag} />}
              <span className="log-msg">{rest}</span>
            </div>
          );
        })}
      </div>
      {!autoScroll && (
        <button
          className="log-scroll-btn"
          onClick={() => {
            setAutoScroll(true);
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
          }}
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

export function SuperpowerTool() {
  const [activeMenu, setActiveMenu] = useState<MenuItem>("logs");
  const [devTagVisible, setDevTagVisible] = useState(true);
  const [appBoundsVisible, setAppBoundsVisible] = useState(true);
  const [containerBoundsVisible, setContainerBoundsVisible] = useState(true);
  const [rootBoundsVisible, setRootBoundsVisible] = useState(true);
  useTheme();

  // Push the initial state to the main window so the outlines turn on
  // the moment the Superpower tool mounts (i.e. when dev mode is opened).
  // Without this, the main app stays at its defaults (false) until each
  // toggle is clicked.
  useEffect(() => {
    void emit("dev-app-bounds-changed", true);
    void emit("dev-container-bounds-changed", true);
    void emit("dev-root-bounds-changed", true);
  }, []);

  const handleDevTagToggle = () => {
    const next = !devTagVisible;
    setDevTagVisible(next);
    invoke("set_dev_mode", { enabled: next });
  };

  const handleAppBoundsToggle = () => {
    const next = !appBoundsVisible;
    setAppBoundsVisible(next);
    void emit("dev-app-bounds-changed", next);
  };

  const handleContainerBoundsToggle = () => {
    const next = !containerBoundsVisible;
    setContainerBoundsVisible(next);
    void emit("dev-container-bounds-changed", next);
  };

  const handleRootBoundsToggle = () => {
    const next = !rootBoundsVisible;
    setRootBoundsVisible(next);
    void emit("dev-root-bounds-changed", next);
  };

  return (
    <div className="superpower">
      <nav className="superpower-sidebar">
        <div className="superpower-logo">Superpower</div>
        <button
          className={`superpower-menu-item ${activeMenu === "logs" ? "active" : ""}`}
          onClick={() => setActiveMenu("logs")}
        >
          <span className="menu-icon">&#9776;</span>
          Logs
        </button>
        <button
          className={`superpower-menu-item ${activeMenu === "scenarios" ? "active" : ""}`}
          onClick={() => setActiveMenu("scenarios")}
        >
          <span className="menu-icon">&#9655;</span>
          Scenarios
        </button>
      </nav>
      <main className="superpower-content">
        <div className="superpower-toolbar">
          <div className="superpower-toolbar-item">
            <span className="superpower-toolbar-label">DEV Tag</span>
            <button
              className={`toggle-switch ${devTagVisible ? "active" : ""}`}
              onClick={handleDevTagToggle}
              data-testid="dev-tag-toggle"
              aria-label="Toggle DEV tag visibility"
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="superpower-toolbar-item">
            <span className="superpower-toolbar-label">App Bounds</span>
            <button
              className={`toggle-switch ${appBoundsVisible ? "active" : ""}`}
              onClick={handleAppBoundsToggle}
              data-testid="app-bounds-toggle"
              aria-label="Toggle app bounds outline"
              title="Show an outline around the app area to reveal the window size"
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="superpower-toolbar-item">
            <span className="superpower-toolbar-label">Container</span>
            <button
              className={`toggle-switch ${containerBoundsVisible ? "active" : ""}`}
              onClick={handleContainerBoundsToggle}
              data-testid="container-bounds-toggle"
              aria-label="Toggle container area outline"
              title="Show a red outline around the content area (inside the window padding)"
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="superpower-toolbar-item">
            <span className="superpower-toolbar-label">Root</span>
            <button
              className={`toggle-switch ${rootBoundsVisible ? "active" : ""}`}
              onClick={handleRootBoundsToggle}
              data-testid="root-bounds-toggle"
              aria-label="Toggle root element outline"
              title="Show a green outline around the #root element (full webview surface)"
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
        {activeMenu === "logs" && <LogViewer />}
        {activeMenu === "scenarios" && <ScenarioViewer />}
      </main>
    </div>
  );
}
