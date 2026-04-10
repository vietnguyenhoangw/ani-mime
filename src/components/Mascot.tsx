import { useState, useEffect, useRef } from "react";
import type { Status } from "../types/status";
import { getSpriteMap, autoStopStatuses } from "../constants/sprites";
import { usePet } from "../hooks/usePet";
import { useGlow } from "../hooks/useGlow";
import { useScale } from "../hooks/useScale";
import { useCustomMimes } from "../hooks/useCustomMimes";
import { readFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { error as logError } from "@tauri-apps/plugin-log";
import "../styles/mascot.css";

interface MascotProps {
  status: Status;
}

export function Mascot({ status }: MascotProps) {
  const { pet } = usePet();
  const { mode: glowMode } = useGlow();
  const { scale } = useScale();
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

  // Resolve custom sprite URL by reading file bytes via FS plugin
  useEffect(() => {
    if (!customMime) {
      setCustomSpriteUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
    appDataDir().then(async (base) => {
      try {
        const filePath = await join(base, "custom-sprites", spriteData.fileName);
        const bytes = await readFile(filePath);
        if (revoked) return;
        const blob = new Blob([bytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        objectUrl = url;
        setCustomSpriteUrl(url);
      } catch (err) {
        logError(`[mascot] failed to load sprite ${spriteData.fileName}: ${err instanceof Error ? err.message : err}`);
      }
    });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
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

  const frameSize = 128 * scale;
  const lastFrameOffset = (frames - 1) * frameSize;

  if (isCustom && !customSpriteUrl) return null;

  return (
    <div
      data-testid="mascot-sprite"
      className={`sprite ${frozen ? "frozen" : ""} ${glowMode !== "off" ? `glow-${glowMode}` : ""}`}
      style={{
        backgroundImage: `url(${spriteUrl})`,
        width: frameSize,
        height: frameSize,
        "--sprite-steps": frames,
        "--sprite-width": `${frames * frameSize}px`,
        "--sprite-height": `${frameSize}px`,
        "--sprite-duration": `${frames * 80}ms`,
        ...(frozen ? { backgroundPosition: `-${lastFrameOffset}px 0` } : {}),
      } as React.CSSProperties}
    />
  );
}
