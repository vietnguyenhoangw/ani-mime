import { describe, it, expect } from "vitest";
import { inwardPopoverPos } from "../../utils/popoverPos";

const BAR = { x: 100, y: 200, width: 40, height: 168 }; // a vertical bar
const PW = 280;
const PH = 260;
const GAP = 8;

describe("inwardPopoverPos", () => {
  it("opens to the RIGHT of a left-edge bar", () => {
    const p = inwardPopoverPos(BAR, "left", PW, PH, GAP);
    expect(p.x).toBe(100 + 40 + GAP);
    expect(p.y).toBe(200);
  });

  it("opens to the LEFT of a right-edge bar", () => {
    const p = inwardPopoverPos(BAR, "right", PW, PH, GAP);
    expect(p.x).toBe(100 - PW - GAP);
    expect(p.y).toBe(200);
  });

  it("opens BELOW a top-edge bar", () => {
    const hbar = { x: 300, y: 30, width: 168, height: 40 };
    const p = inwardPopoverPos(hbar, "top", PW, PH, GAP);
    expect(p.y).toBe(30 + 40 + GAP);
    expect(p.x).toBe(300);
  });

  it("opens ABOVE a bottom-edge bar", () => {
    const hbar = { x: 300, y: 752, width: 168, height: 40 };
    const p = inwardPopoverPos(hbar, "bottom", PW, PH, GAP);
    expect(p.y).toBe(752 - PH - GAP);
    expect(p.x).toBe(300);
  });
});
