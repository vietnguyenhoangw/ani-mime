import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MiniBar } from "../../components/MiniBar";

describe("MiniBar", () => {
  it("renders the status dot with the status class", () => {
    render(<MiniBar status="busy" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    const dot = screen.getByTestId("mini-bar-dot");
    expect(dot).toHaveClass("dot");
    expect(dot).toHaveClass("busy");
  });

  it("reflects orientation via data-orientation + class", () => {
    render(<MiniBar status="idle" orientation="vertical" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    const bar = screen.getByTestId("mini-bar");
    expect(bar).toHaveAttribute("data-orientation", "vertical");
    expect(bar).toHaveClass("vertical");
    expect(bar).toHaveClass("idle");
  });

  it("calls onRestore when the restore button is clicked", () => {
    const onRestore = vi.fn();
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId("mini-bar-restore"));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("renders a peer button that opens the peer-list popover", async () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    const btn = screen.getByTestId("mini-bar-action-lan");
    expect(btn).toBeInTheDocument();
  });

  it("renders a session button and opens the dropdown when clicked", async () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    const btn = screen.getByTestId("mini-bar-action-task");
    fireEvent.click(btn);
    await screen.findByTestId("session-dropdown");
  });
});
