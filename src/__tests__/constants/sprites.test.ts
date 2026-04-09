import {
  getSpriteMap,
  registerCustomSprites,
  unregisterCustomSprites,
  getMimesByCategory,
  pets,
} from "../../constants/sprites";
import type { Status, SpriteConfig } from "../../types/status";

describe("sprites", () => {
  afterEach(() => {
    // Clean up any custom registrations
    unregisterCustomSprites("custom-test");
  });

  describe("getSpriteMap", () => {
    it("returns valid sprite map for rottweiler", () => {
      const map = getSpriteMap("rottweiler");
      const expectedStatuses: Status[] = [
        "idle",
        "busy",
        "service",
        "disconnected",
        "searching",
        "initializing",
        "visiting",
      ];

      for (const status of expectedStatuses) {
        expect(map[status]).toBeDefined();
        expect(map[status].file).toBeTruthy();
        expect(typeof map[status].frames).toBe("number");
        expect(map[status].frames).toBeGreaterThan(0);
      }
    });

    it("falls back to first pet's sprites for nonexistent pet", () => {
      const map = getSpriteMap("nonexistent");
      expect(map).toEqual(pets[0].sprites);
    });
  });

  describe("registerCustomSprites / unregisterCustomSprites", () => {
    const customSprites: Record<Status, SpriteConfig> = {
      idle: { file: "custom-idle.png", frames: 4 },
      busy: { file: "custom-busy.png", frames: 6 },
      service: { file: "custom-service.png", frames: 3 },
      disconnected: { file: "custom-sleep.png", frames: 2 },
      searching: { file: "custom-search.png", frames: 5 },
      initializing: { file: "custom-init.png", frames: 5 },
      visiting: { file: "custom-visit.png", frames: 4 },
    };

    it("returns custom sprites after registration", () => {
      registerCustomSprites("custom-test", customSprites);
      const map = getSpriteMap("custom-test");
      expect(map).toEqual(customSprites);
    });

    it("falls back after unregistration", () => {
      registerCustomSprites("custom-test", customSprites);
      expect(getSpriteMap("custom-test")).toEqual(customSprites);

      unregisterCustomSprites("custom-test");
      // "custom-test" is not a built-in pet, so falls back to first pet
      const map = getSpriteMap("custom-test");
      expect(map).toEqual(pets[0].sprites);
    });
  });

  describe("getMimesByCategory", () => {
    it("returns only pet-category mimes", () => {
      const petMimes = getMimesByCategory("pet");
      expect(petMimes.length).toBeGreaterThan(0);
      for (const mime of petMimes) {
        expect(mime.category).toBe("pet");
      }
    });

    it("returns only character-category mimes", () => {
      const charMimes = getMimesByCategory("character");
      expect(charMimes.length).toBeGreaterThan(0);
      for (const mime of charMimes) {
        expect(mime.category).toBe("character");
      }
    });

    it("returns empty array for nonexistent category", () => {
      const result = getMimesByCategory("nonexistent" as any);
      expect(result).toEqual([]);
    });
  });
});
