export type Status =
  | "initializing"
  | "searching"
  | "idle"
  | "busy"
  | "service"
  | "disconnected"
  | "visiting";

export interface SpriteConfig {
  file: string;
  frames: number;
}

export type BuiltinPet = "rottweiler" | "dalmatian" | "samurai" | "hancock" | "genjuro";

// Pet can be a built-in ID or a custom mime ID (e.g. "custom-abc123")
export type Pet = BuiltinPet | (string & {});

export type MimeCategory = "pet" | "character" | "custom";

export interface PetInfo {
  id: Pet;
  name: string;
  category: MimeCategory;
  preview: string;
  sprites: Record<Status, SpriteConfig>;
}

export interface CustomMimeData {
  id: string;
  name: string;
  sprites: Record<Status, { fileName: string; frames: number }>;
}
