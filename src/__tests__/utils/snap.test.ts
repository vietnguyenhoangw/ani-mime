import { describe, it, expect } from "vitest";
import { computeSnap, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS } from "../../utils/snap";

const MON = { x: 0, y: 0, width: 1000, height: 800 };
const LONG = 168;
const SHORT = 40;

describe("computeSnap", () => {
  it("snaps to the LEFT edge, TOP corner (vertical bar)", () => {
    const r = computeSnap({ x: 30, y: 16, width: 40, height: 168 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("left");
    expect(r.orientation).toBe("vertical");
    expect(r.width).toBe(SHORT);
    expect(r.height).toBe(LONG);
    expect(r.x).toBe(8);
    expect(r.y).toBe(30);
  });

  it("snaps to the RIGHT edge, BOTTOM corner (vertical bar)", () => {
    const r = computeSnap({ x: 930, y: 616, width: 40, height: 168 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("right");
    expect(r.orientation).toBe("vertical");
    expect(r.x).toBe(1000 - SHORT - 8);
    expect(r.y).toBe(800 - LONG - 8);
  });

  it("snaps to the TOP edge, RIGHT corner (horizontal bar)", () => {
    const r = computeSnap({ x: 816, y: 30, width: 168, height: 40 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("top");
    expect(r.orientation).toBe("horizontal");
    expect(r.width).toBe(LONG);
    expect(r.height).toBe(SHORT);
    expect(r.y).toBe(30);
    expect(r.x).toBe(1000 - LONG - 8);
  });

  it("snaps to the BOTTOM edge, LEFT corner (horizontal bar)", () => {
    const r = computeSnap({ x: 16, y: 730, width: 168, height: 40 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("bottom");
    expect(r.orientation).toBe("horizontal");
    expect(r.y).toBe(800 - SHORT - 8);
    expect(r.x).toBe(8);
  });

  it("exports sane default bar constants", () => {
    expect(BAR_LONG).toBeGreaterThan(BAR_SHORT);
    expect(DEFAULT_MARGINS.menuBar).toBeGreaterThanOrEqual(DEFAULT_MARGINS.edge);
  });
});
