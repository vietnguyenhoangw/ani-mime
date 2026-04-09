import type { Status } from "../types/status";
import "../styles/status-pill.css";

interface StatusPillProps {
  status: Status;
  glow?: boolean;
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

export function StatusPill({ status, glow }: StatusPillProps) {
  return (
    <div data-testid="status-pill" className={`pill ${glow ? "neon-glow" : ""} ${status === "busy" ? "neon-busy" : ""}`}>
      <span data-testid="status-dot" className={dotClassMap[status] ?? "dot searching"} />
      <span data-testid="status-label" className="label">{labelMap[status] ?? "Searching..."}</span>
    </div>
  );
}
