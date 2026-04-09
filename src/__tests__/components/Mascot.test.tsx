import { render, act } from "@testing-library/react";
import { Mascot } from "../../components/Mascot";
import type { Status } from "../../types/status";

// Mock @tauri-apps/api/path (not aliased in vitest config)
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "/mock/app/data/"),
}));

// Mock @tauri-apps/api/dpi (not aliased in vitest config)
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class LogicalSize {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  },
}));

// Mock hooks used by Mascot
vi.mock("../../hooks/usePet", () => ({
  usePet: () => ({ pet: "rottweiler", setPet: vi.fn(), loaded: true }),
}));

vi.mock("../../hooks/useGlow", () => ({
  useGlow: () => ({ mode: "off", setMode: vi.fn() }),
}));

vi.mock("../../hooks/useScale", () => ({
  useScale: () => ({ scale: 1, setScale: vi.fn(), SCALE_PRESETS: [0.5, 1, 1.5, 2] }),
}));

vi.mock("../../hooks/useCustomMimes", () => ({
  useCustomMimes: () => ({ mimes: [], loaded: true, pickSpriteFile: vi.fn(), addMime: vi.fn(), addMimeFromBlobs: vi.fn(), deleteMime: vi.fn(), getSpriteUrl: vi.fn() }),
}));

describe("Mascot", () => {
  const allStatuses: Status[] = [
    "initializing",
    "searching",
    "idle",
    "busy",
    "service",
    "disconnected",
    "visiting",
  ];

  it.each(allStatuses)("renders sprite div for status '%s'", (status) => {
    const { container } = render(<Mascot status={status} />);
    const sprite = container.querySelector(".sprite");
    expect(sprite).toBeInTheDocument();
  });

  it("sets backgroundImage style with sprite URL", () => {
    const { container } = render(<Mascot status="idle" />);
    const sprite = container.querySelector(".sprite") as HTMLElement;
    expect(sprite.style.backgroundImage).toContain("url(");
  });

  it("sets sprite dimensions to 128px at scale 1", () => {
    const { container } = render(<Mascot status="idle" />);
    const sprite = container.querySelector(".sprite") as HTMLElement;
    expect(sprite.style.width).toBe("128px");
    expect(sprite.style.height).toBe("128px");
  });

  it("does not have frozen class initially for busy status", () => {
    const { container } = render(<Mascot status="busy" />);
    const sprite = container.querySelector(".sprite");
    expect(sprite).not.toHaveClass("frozen");
  });

  it("sets CSS custom properties for sprite animation", () => {
    const { container } = render(<Mascot status="idle" />);
    const sprite = container.querySelector(".sprite") as HTMLElement;
    // The idle rottweiler has 8 frames
    expect(sprite.style.getPropertyValue("--sprite-steps")).toBe("8");
  });

  describe("auto-freeze timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("adds frozen class after 10,000ms for idle status", () => {
      const { container } = render(<Mascot status="idle" />);
      const sprite = container.querySelector(".sprite");

      expect(sprite).not.toHaveClass("frozen");

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(sprite).toHaveClass("frozen");
    });

    it("adds frozen class after 10,000ms for disconnected status", () => {
      const { container } = render(<Mascot status="disconnected" />);
      const sprite = container.querySelector(".sprite");

      expect(sprite).not.toHaveClass("frozen");

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(sprite).toHaveClass("frozen");
    });

    it("does NOT add frozen class for busy status even after 15s", () => {
      const { container } = render(<Mascot status="busy" />);
      const sprite = container.querySelector(".sprite");

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(sprite).not.toHaveClass("frozen");
    });

    it("resets timer when status changes from idle to busy", () => {
      const { container, rerender } = render(<Mascot status="idle" />);
      const sprite = container.querySelector(".sprite");

      // Advance 8s while idle — not yet frozen
      act(() => {
        vi.advanceTimersByTime(8_000);
      });
      expect(sprite).not.toHaveClass("frozen");

      // Switch to busy — timer should reset, frozen should clear
      rerender(<Mascot status="busy" />);

      // Advance another 10s — busy does not freeze
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(sprite).not.toHaveClass("frozen");
    });
  });
});
