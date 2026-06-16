import { describe, it, expect } from "vitest";
import { eventToAccelerator } from "./accelerator.js";

const ev = (over) => ({
  metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "", ...over,
});

describe("eventToAccelerator", () => {
  it("maps meta/ctrl to CmdOrCtrl and uppercases letters", () => {
    expect(eventToAccelerator(ev({ metaKey: true, shiftKey: true, key: "g" })))
      .toBe("CmdOrCtrl+Shift+G");
    expect(eventToAccelerator(ev({ ctrlKey: true, key: "k" })))
      .toBe("CmdOrCtrl+K");
  });

  it("supports Alt and function/named keys", () => {
    expect(eventToAccelerator(ev({ altKey: true, key: "F1" }))).toBe("Alt+F1");
    expect(eventToAccelerator(ev({ metaKey: true, key: "ArrowUp" })))
      .toBe("CmdOrCtrl+Up");
  });

  it("returns null when only modifiers are pressed", () => {
    expect(eventToAccelerator(ev({ metaKey: true, key: "Meta" }))).toBeNull();
    expect(eventToAccelerator(ev({ shiftKey: true, key: "Shift" }))).toBeNull();
  });

  it("requires at least one modifier", () => {
    expect(eventToAccelerator(ev({ key: "g" }))).toBeNull();
  });
});
