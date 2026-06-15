import { describe, it, expect } from "vitest";
import { computeSnap, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS, miniBarLength, MINI_BAR } from "../../utils/snap";

const MON = { x: 0, y: 0, width: 1000, height: 800 };

describe("computeSnap", () => {
  it("snaps to the LEFT edge, TOP corner (vertical bar)", () => {
    const r = computeSnap({ x: 30, y: 16, width: 40, height: 168 }, MON, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("left");
    expect(r.orientation).toBe("vertical");
    expect(r.width).toBe(BAR_SHORT);
    expect(r.height).toBe(BAR_LONG);
    expect(r.x).toBe(8);
    expect(r.y).toBe(30);
  });

  it("snaps to the RIGHT edge, BOTTOM corner (vertical bar)", () => {
    const r = computeSnap({ x: 930, y: 616, width: 40, height: 168 }, MON, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("right");
    expect(r.orientation).toBe("vertical");
    expect(r.x).toBe(1000 - BAR_SHORT - 8);
    expect(r.y).toBe(800 - BAR_LONG - 8);
  });

  it("snaps to the TOP edge, RIGHT corner (horizontal bar)", () => {
    const r = computeSnap({ x: 816, y: 30, width: 168, height: 40 }, MON, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("top");
    expect(r.orientation).toBe("horizontal");
    expect(r.width).toBe(BAR_LONG);
    expect(r.height).toBe(BAR_SHORT);
    expect(r.y).toBe(30);
    expect(r.x).toBe(1000 - BAR_LONG - 8);
  });

  it("snaps to the BOTTOM edge, LEFT corner (horizontal bar)", () => {
    const r = computeSnap({ x: 16, y: 730, width: 168, height: 40 }, MON, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("bottom");
    expect(r.orientation).toBe("horizontal");
    expect(r.y).toBe(800 - BAR_SHORT - 8);
    expect(r.x).toBe(8);
  });

  it("exports sane default bar constants", () => {
    expect(BAR_LONG).toBeGreaterThan(BAR_SHORT);
    expect(DEFAULT_MARGINS.menuBar).toBeGreaterThanOrEqual(DEFAULT_MARGINS.edge);
    expect(DEFAULT_MARGINS).toEqual({ edge: 8, menuBar: 30 });
    expect(BAR_LONG).toBe(168);
    expect(BAR_SHORT).toBe(40);
  });

  it("snaps to the LEFT edge on a secondary monitor with negative origin", () => {
    const secondMon = { x: -2560, y: 0, width: 2560, height: 1440 };
    // Window centered near the left edge of the secondary monitor
    const win = { x: -2550, y: 600, width: BAR_SHORT, height: BAR_LONG };
    const r = computeSnap(win, secondMon, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("left");
    expect(r.x).toBe(-2560 + DEFAULT_MARGINS.edge);
  });
});

describe("miniBarLength", () => {
  it("accounts for dot, padding and borders with zero buttons", () => {
    expect(miniBarLength(0)).toBe(
      2 * MINI_BAR.border + 2 * MINI_BAR.padding + MINI_BAR.dot
    );
  });

  it("grows by exactly one button + gap per added tool", () => {
    expect(miniBarLength(3) - miniBarLength(2)).toBe(MINI_BAR.gap + MINI_BAR.button);
  });

  it("hugs content far tighter than the legacy fixed width", () => {
    // 2 buttons (session + restore, peer off) should be well under BAR_LONG.
    expect(miniBarLength(2)).toBeLessThan(BAR_LONG);
  });
});
