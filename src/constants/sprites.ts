import type { Status, SpriteConfig, Pet, PetInfo, MimeCategory } from "../types/status";

export const pets: PetInfo[] = [
  {
    id: "rottweiler",
    name: "Rottweiler",
    category: "pet",
    preview: "Sittiing.png",
    sprites: {
      disconnected: { file: "SleepDogg.png", frames: 8 },
      busy: { file: "RottweilerSniff.png", frames: 31 },
      service: { file: "RottweilerBark.png", frames: 12 },
      idle: { file: "Sittiing.png", frames: 8 },
      searching: { file: "RottweilerIdle.png", frames: 6 },
      initializing: { file: "RottweilerIdle.png", frames: 6 },
      visiting: { file: "Sittiing.png", frames: 8 },
    },
  },
  {
    id: "dalmatian",
    name: "Dalmatian",
    category: "pet",
    preview: "DalmatianSitting.png",
    sprites: {
      disconnected: { file: "DalmatianSleep.png", frames: 8 },
      busy: { file: "DalmatianSniff.png", frames: 26 },
      service: { file: "DalmatianBark.png", frames: 12 },
      idle: { file: "DalmatianSitting.png", frames: 8 },
      searching: { file: "DalmatianIdle.png", frames: 7 },
      initializing: { file: "DalmatianIdle.png", frames: 7 },
      visiting: { file: "DalmatianSitting.png", frames: 8 },
    },
  },
  {
    id: "samurai",
    name: "Samurai",
    category: "character",
    preview: "SamuraiSitting.png",
    sprites: {
      disconnected: { file: "SamuraiSleep.png", frames: 3 },
      busy: { file: "SamuraiBark.png", frames: 6 },
      service: { file: "SamuraiSniff.png", frames: 8 },
      idle: { file: "SamuraiSitting.png", frames: 6 },
      searching: { file: "SamuraiIdle.png", frames: 8 },
      initializing: { file: "SamuraiIdle.png", frames: 8 },
      visiting: { file: "SamuraiSitting.png", frames: 6 },
    },
  },
  {
    id: "hancock",
    name: "Hancock",
    category: "character",
    preview: "HancockSitting.png",
    sprites: {
      disconnected: { file: "HancockSleep.png", frames: 1 },
      busy: { file: "HancockBark.png", frames: 9 },
      service: { file: "HancockSniff.png", frames: 18 },
      idle: { file: "HancockSitting.png", frames: 10 },
      searching: { file: "HancockIdle.png", frames: 17 },
      initializing: { file: "HancockIdle.png", frames: 17 },
      visiting: { file: "HancockSitting.png", frames: 10 },
    },
  },
];

export const mimeCategories: { key: MimeCategory; label: string }[] = [
  { key: "pet", label: "Pet" },
  { key: "character", label: "Character" },
  { key: "custom", label: "Custom" },
];

export function getMimesByCategory(category: MimeCategory): PetInfo[] {
  return pets.filter((p) => p.category === category);
}

const customSpriteOverrides: Record<string, Record<Status, SpriteConfig>> = {};

export function registerCustomSprites(petId: string, sprites: Record<Status, SpriteConfig>) {
  customSpriteOverrides[petId] = sprites;
}

export function unregisterCustomSprites(petId: string) {
  delete customSpriteOverrides[petId];
}

export function getSpriteMap(petId: Pet): Record<Status, SpriteConfig> {
  if (customSpriteOverrides[petId]) {
    return customSpriteOverrides[petId];
  }
  const pet = pets.find((p) => p.id === petId);
  return pet ? pet.sprites : pets[0].sprites;
}

export const autoStopStatuses = new Set<Status>(["idle", "disconnected"]);
