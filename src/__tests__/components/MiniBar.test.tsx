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

  it("shows the peer button only when the LAN list is enabled", async () => {
    enableLanList();
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    expect(await screen.findByTestId("mini-bar-action-lan")).toBeInTheDocument();
  });

  it("hides the peer button when the LAN list is disabled (matches pet mode default)", () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    expect(screen.queryByTestId("mini-bar-action-lan")).toBeNull();
  });

  it("disables the peer button while visiting", async () => {
    enableLanList();
    render(<MiniBar status="visiting" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    const btn = await screen.findByTestId("mini-bar-action-lan");
    expect(btn).toBeDisabled();
  });

  it("renders a session button and opens the dropdown when clicked", async () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" snapToNearest={() => {}} onRestore={() => {}} />);
    const btn = screen.getByTestId("mini-bar-action-task");
    fireEvent.click(btn);
    await screen.findByTestId("session-dropdown");
  });
});
