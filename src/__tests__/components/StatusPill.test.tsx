import { render, screen, fireEvent } from "@testing-library/react";
import { StatusPill } from "../../components/StatusPill";
import type { Status } from "../../types/status";

describe("StatusPill", () => {
  const statusLabels: Record<Status, string> = {
    service: "Service",
    busy: "Working...",
    idle: "Free",
    disconnected: "Sleep",
    initializing: "Initializing...",
    searching: "Searching...",
    visiting: "Visiting...",
  };

  it.each(Object.entries(statusLabels))(
    "renders label '%s' for status '%s'",
    (status, label) => {
      render(<StatusPill status={status as Status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  );

  it.each([
    "service",
    "busy",
    "idle",
    "disconnected",
    "initializing",
    "searching",
    "visiting",
  ] as Status[])("applies correct CSS class for status '%s'", (status) => {
    const { container } = render(<StatusPill status={status} />);
    const dot = container.querySelector(".dot");
    expect(dot).toHaveClass(status);
  });

  it("applies neon-glow class when glow=true", () => {
    const { container } = render(<StatusPill status="idle" glow={true} />);
    const pill = container.querySelector(".pill");
    expect(pill).toHaveClass("neon-glow");
  });

  it("does not apply neon-glow class when glow=false", () => {
    const { container } = render(<StatusPill status="idle" glow={false} />);
    const pill = container.querySelector(".pill");
    expect(pill).not.toHaveClass("neon-glow");
  });

  it("applies neon-busy class when status is busy", () => {
    const { container } = render(<StatusPill status="busy" />);
    const pill = container.querySelector(".pill");
    expect(pill).toHaveClass("neon-busy");
  });

  it("does not apply neon-busy class for non-busy status", () => {
    const { container } = render(<StatusPill status="idle" />);
    const pill = container.querySelector(".pill");
    expect(pill).not.toHaveClass("neon-busy");
  });

  it("renders a minimize button and calls onMinimize when clicked", () => {
    const onMinimize = vi.fn();
    render(<StatusPill status="idle" onMinimize={onMinimize} />);
    const btn = screen.getByTestId("pill-action-minimize");
    fireEvent.click(btn);
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it("does not render a minimize button when onMinimize is omitted", () => {
    render(<StatusPill status="idle" />);
    expect(screen.queryByTestId("pill-action-minimize")).toBeNull();
  });
});
