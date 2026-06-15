import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MiniBar } from "../../components/MiniBar";
import { mockStoreValue } from "../../__mocks__/tauri-store";

/** Turn the LAN-list setting on so the peer button renders (defaults off,
 *  matching the pet-mode StatusPill). */
function enableLanList() {
  mockStoreValue("settings.json", "lanListDefaultFalseMigrated", true);
  mockStoreValue("settings.json", "lanListEnabled", true);
}

describe("MiniBar", () => {
  it("renders the status dot with the status class", () => {
    render(<MiniBar status="busy" orientation="horizontal" edge="bottom" onGripMouseDown={() => {}} onRestore={() => {}} />);
    const dot = screen.getByTestId("mini-bar-dot");
    expect(dot).toHaveClass("dot");
    expect(dot).toHaveClass("busy");
  });

  it("reflects orientation via data-orientation + class", () => {
    render(<MiniBar status="idle" orientation="vertical" edge="bottom" onGripMouseDown={() => {}} onRestore={() => {}} />);
    const bar = screen.getByTestId("mini-bar");
    expect(bar).toHaveAttribute("data-orientation", "vertical");
    expect(bar).toHaveClass("vertical");
    expect(bar).toHaveClass("idle");
  });

  it("starts the edge drag on grip mousedown", () => {
    const onGripMouseDown = vi.fn();
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" onGripMouseDown={onGripMouseDown} onRestore={() => {}} />);
    const grip = screen.getByTestId("mini-bar-drag-handle");
    expect(grip).toBeInTheDocument();
    fireEvent.mouseDown(grip);
    expect(onGripMouseDown).toHaveBeenCalledTimes(1);
  });

  it("calls onRestore when the restore button is clicked", () => {
    const onRestore = vi.fn();
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" onGripMouseDown={() => {}} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId("mini-bar-restore"));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("shows the peer button only when the LAN list is enabled", async () => {
    enableLanList();
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" onGripMouseDown={() => {}} onRestore={() => {}} />);
    expect(await screen.findByTestId("mini-bar-action-lan")).toBeInTheDocument();
  });

  it("hides the peer button when the LAN list is disabled (matches pet mode default)", () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" onGripMouseDown={() => {}} onRestore={() => {}} />);
    expect(screen.queryByTestId("mini-bar-action-lan")).toBeNull();
  });

  it("disables the peer button while visiting", async () => {
    enableLanList();
    render(<MiniBar status="visiting" orientation="horizontal" edge="bottom" onGripMouseDown={() => {}} onRestore={() => {}} />);
    const btn = await screen.findByTestId("mini-bar-action-lan");
    expect(btn).toBeDisabled();
  });

  it("renders a session button (mini mode opens a window, not an inline list)", () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" onGripMouseDown={() => {}} onRestore={() => {}} />);
    expect(screen.getByTestId("mini-bar-action-task")).toBeInTheDocument();
    // The inline dropdown belongs to pet mode only; it must not render here.
    expect(screen.queryByTestId("session-dropdown")).toBeNull();
  });
});
