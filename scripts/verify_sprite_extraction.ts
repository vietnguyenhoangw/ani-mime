#!/usr/bin/env bun
/**
 * Verify that the TS spriteSheetProcessor detection logic produces
 * the same frame boundaries as the Python extract_sprites.py script.
 *
 * Uses @napi-rs/canvas as a drop-in for HTMLCanvasElement.
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "fs";
import { resolve } from "path";

// Mirror the constants from spriteSheetProcessor.ts
const BG_TOLERANCE = 30;
const ALPHA_THRESHOLD = 10;
const MIN_GAP = 5;
const MIN_REGION_WIDTH = 10;
const MIN_FRAME_SIZE = 12;

type BgColor = { r: number; g: number; b: number };

function colorDistance(a: BgColor, b: BgColor): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function detectBgColor(ctx: any, width: number, height: number): BgColor {
  const corners = [
    ctx.getImageData(1, 1, 1, 1).data,
    ctx.getImageData(width - 2, 1, 1, 1).data,
    ctx.getImageData(1, height - 2, 1, 1).data,
    ctx.getImageData(width - 2, height - 2, 1, 1).data,
  ];
  const colors = corners.map((d: Uint8ClampedArray) => ({ r: d[0], g: d[1], b: d[2] }));
  let bestColor = colors[0];
  let bestCount = 0;
  for (const candidate of colors) {
    const count = colors.filter((c: BgColor) => colorDistance(c, candidate) <= BG_TOLERANCE).length;
    if (count > bestCount) {
      bestCount = count;
      bestColor = candidate;
    }
  }
  return bestColor;
}

function removeBg(ctx: any, width: number, height: number, bgColor: BgColor): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const dist = colorDistance(
      { r: data[i], g: data[i + 1], b: data[i + 2] },
      bgColor
    );
    if (dist <= BG_TOLERANCE) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function detectRows(ctx: any, width: number, height: number): { y1: number; y2: number }[] {
  const rows: { y1: number; y2: number }[] = [];
  let inContent = false;
  let rowStart = 0;

  for (let y = 0; y < height; y++) {
    const rowData = ctx.getImageData(0, y, width, 1).data;
    let hasContent = false;
    for (let i = 3; i < rowData.length; i += 4) {
      if (rowData[i] > ALPHA_THRESHOLD) {
        hasContent = true;
        break;
      }
    }
    if (hasContent && !inContent) {
      rowStart = y;
      inContent = true;
    } else if (!hasContent && inContent) {
      rows.push({ y1: rowStart, y2: y });
      inContent = false;
    }
  }
  if (inContent) {
    rows.push({ y1: rowStart, y2: height });
  }
  return rows;
}

function detectColumns(ctx: any, canvasWidth: number, y1: number, y2: number): { x1: number; x2: number }[] {
  const rowHeight = y2 - y1;

  // Pass 1: raw content regions
  const raw: { x1: number; x2: number }[] = [];
  let inContent = false;
  let colStart = 0;

  for (let x = 0; x < canvasWidth; x++) {
    const colData = ctx.getImageData(x, y1, 1, rowHeight).data;
    let hasContent = false;
    for (let i = 3; i < colData.length; i += 4) {
      if (colData[i] > ALPHA_THRESHOLD) {
        hasContent = true;
        break;
      }
    }
    if (hasContent && !inContent) {
      colStart = x;
      inContent = true;
    } else if (!hasContent && inContent) {
      raw.push({ x1: colStart, x2: x });
      inContent = false;
    }
  }
  if (inContent) {
    raw.push({ x1: colStart, x2: canvasWidth });
  }
  if (raw.length === 0) return [];

  // Pass 2: bridge gaps smaller than MIN_GAP
  const merged: { x1: number; x2: number }[] = [{ ...raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1];
    const gap = raw[i].x1 - prev.x2;
    if (gap < MIN_GAP) {
      prev.x2 = raw[i].x2;
    } else {
      merged.push({ ...raw[i] });
    }
  }

  // Pass 3: absorb narrow slivers into nearest neighbor
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].x2 - merged[i].x1 < MIN_REGION_WIDTH && merged.length > 1) {
        if (i === 0) {
          merged[1].x1 = merged[i].x1;
        } else if (i === merged.length - 1) {
          merged[i - 1].x2 = merged[i].x2;
        } else {
          const gapLeft = merged[i].x1 - merged[i - 1].x2;
          const gapRight = merged[i + 1].x1 - merged[i].x2;
          if (gapLeft <= gapRight) {
            merged[i - 1].x2 = merged[i].x2;
          } else {
            merged[i + 1].x1 = merged[i].x1;
          }
        }
        merged.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return merged;
}

function getTightBBox(ctx: any, x1: number, y1: number, x2: number, y2: number): { x1: number; y1: number; x2: number; y2: number; w: number; h: number } | null {
  const sw = x2 - x1;
  const sh = y2 - y1;
  const imageData = ctx.getImageData(x1, y1, sw, sh);
  const { data } = imageData;
  let minX = sw, minY = sh, maxX = 0, maxY = 0;
  let found = false;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) return null;
  return {
    x1: x1 + minX, y1: y1 + minY,
    x2: x1 + maxX + 1, y2: y1 + maxY + 1,
    w: maxX - minX + 1, h: maxY - minY + 1,
  };
}

interface FrameResult {
  file: string;
  width: number;
  height: number;
}

async function processSheet(inputPath: string): Promise<FrameResult[]> {
  const img = await loadImage(inputPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const bgColor = detectBgColor(ctx, img.width, img.height);
  console.log(`  Background: RGB(${bgColor.r},${bgColor.g},${bgColor.b})`);

  removeBg(ctx, img.width, img.height, bgColor);
  const rows = detectRows(ctx, img.width, img.height);
  console.log(`  Rows: ${rows.length}`);

  const frames: FrameResult[] = [];
  let frameNum = 1;

  for (const row of rows) {
    const cols = detectColumns(ctx, img.width, row.y1, row.y2);
    const rowFrames: string[] = [];

    for (const col of cols) {
      const bbox = getTightBBox(ctx, col.x1, row.y1, col.x2, row.y2);
      if (!bbox) continue;
      // Skip noise frames (same as Python's --min-size filter)
      if (bbox.w < MIN_FRAME_SIZE && bbox.h < MIN_FRAME_SIZE) continue;
      const fname = `frame_${String(frameNum).padStart(3, "0")}.png`;
      frames.push({ file: fname, width: bbox.w, height: bbox.h });
      rowFrames.push(`${bbox.w}x${bbox.h}`);
      frameNum++;
    }

    console.log(`  Row (y=${row.y1}-${row.y2}): ${rowFrames.length} frames  [${rowFrames.join(", ")}]`);
  }

  return frames;
}

async function compare(name: string, inputPath: string, manifestPath: string): Promise<boolean> {
  console.log(`\n=== ${name} ===`);
  console.log(`Input: ${inputPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const expected: FrameResult[] = manifest.frames;

  const actual = await processSheet(inputPath);

  console.log(`\n  Expected: ${expected.length} frames`);
  console.log(`  Actual:   ${actual.length} frames`);

  if (actual.length !== expected.length) {
    console.log(`  ❌ FRAME COUNT MISMATCH`);

    // Show per-row differences
    const maxLen = Math.max(actual.length, expected.length);
    let mismatches = 0;
    for (let i = 0; i < maxLen; i++) {
      const a = actual[i];
      const e = expected[i];
      if (!a || !e || a.width !== e.width || a.height !== e.height) {
        const aStr = a ? `${a.width}x${a.height}` : "MISSING";
        const eStr = e ? `${e.width}x${e.height}` : "MISSING";
        if (mismatches < 20) {
          console.log(`    Frame ${i + 1}: TS=${aStr}  Python=${eStr}`);
        }
        mismatches++;
      }
    }
    if (mismatches > 20) {
      console.log(`    ... and ${mismatches - 20} more mismatches`);
    }
    return false;
  }

  let mismatches = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a.width !== e.width || a.height !== e.height) {
      if (mismatches < 20) {
        console.log(`    Frame ${i + 1}: TS=${a.width}x${a.height}  Python=${e.width}x${e.height}`);
      }
      mismatches++;
    }
  }

  if (mismatches > 0) {
    if (mismatches > 20) console.log(`    ... and ${mismatches - 20} more`);
    console.log(`  ❌ ${mismatches} DIMENSION MISMATCHES`);
    return false;
  }

  console.log(`  ✅ All ${actual.length} frames match`);
  return true;
}

// --- Main ---
const fixturesDir = resolve(import.meta.dir, "../src/__tests__/fixtures/sprites");

const results = await Promise.all([
  compare(
    "Charlotte",
    resolve(fixturesDir, "charlotte/input.png"),
    resolve(fixturesDir, "charlotte/manifest.json")
  ),
]);

const allPassed = results.every(Boolean);
console.log(`\n${allPassed ? "✅ ALL PASSED" : "❌ SOME FAILED"}`);
process.exit(allPassed ? 0 : 1);
