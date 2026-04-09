import { useState, useEffect, useRef } from "react";
import type { Status } from "../types/status";
import { getSpriteMap, autoStopStatuses } from "../constants/sprites";
import { usePet } from "../hooks/usePet";
import { useGlow } from "../hooks/useGlow";
import { useCustomMimes } from "../hooks/useCustomMimes";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import "../styles/mascot.css";

interface MascotProps {
  status: Status;
}

export function Mascot({ status }: MascotProps) {
  const { pet } = usePet();
  const { mode: glowMode } = useGlow();
  const { mimes } = useCustomMimes();
  const [frozen, setFrozen] = useState(false);
  const [customSpriteUrl, setCustomSpriteUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isCustom = pet.startsWith("custom-");
  const customMime = isCustom ? mimes.find((m) => m.id === pet) : null;

  useEffect(() => {
    clearTimeout(timerRef.current);
    setFrozen(false);

    if (autoStopStatuses.has(status)) {
      timerRef.current = setTimeout(() => setFrozen(true), 10_000);
    }

    return () => clearTimeout(timerRef.current);
  }, [status]);

  // Resolve custom sprite URL from filesystem
  useEffect(() => {
    if (!customMime) {
      setCustomSpriteUrl(null);
      return;
    }
    const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
    appDataDir().then((base) => {
      const url = convertFileSrc(`${base}custom-sprites/${spriteData.fileName}`);
      setCustomSpriteUrl(url);
    });
  }, [customMime, status]);

  let spriteUrl: string;
  let frames: number;

  if (isCustom && customMime) {
    const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
    frames = spriteData.frames;
    spriteUrl = customSpriteUrl ?? "";
  } else {
    const spriteMap = getSpriteMap(pet);
    const sprite = spriteMap[status] ?? spriteMap.searching;
    frames = sprite.frames;
    spriteUrl = new URL(
      `../assets/sprites/${sprite.file}`,
      import.meta.url
    ).href;
  }

  const lastFrameOffset = (frames - 1) * 128;

  if (isCustom && !customSpriteUrl) return null;

  return (
    <div
      className={`sprite ${frozen ? "frozen" : ""} ${glowMode !== "off" ? `glow-${glowMode}` : ""}`}
      style={{
        backgroundImage: `url(${spriteUrl})`,
        width: 128,
        height: 128,
        "--sprite-steps": frames,
        "--sprite-width": `${frames * 128}px`,
        "--sprite-duration": `${frames * 80}ms`,
        ...(frozen ? { backgroundPosition: `-${lastFrameOffset}px 0` } : {}),
      } as React.CSSProperties}
    />
  );
}
