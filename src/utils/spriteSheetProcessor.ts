const FRAME_SIZE = 128;
const BG_TOLERANCE = 30;
const ALPHA_THRESHOLD = 10;

export interface DetectedRow {
  index: number;
  y1: number;
  y2: number;
  height: number;
  sprites: { x1: number; x2: number; width: number }[];
  frameCount: number;
}

export interface ProcessedStrip {
  blob: Uint8Array;
  frames: number;
}

/** Load an image from a file path or data URL */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export type BgColor = { r: number; g: number; b: number };

function colorDistance(a: BgColor, b: BgColor): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** Detect the dominant background color by sampling the 4 corners */
export function detectBgColor(canvas: HTMLCanvasElement): BgColor {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;

  const corners = [
    ctx.getImageData(1, 1, 1, 1).data,
    ctx.getImageData(width - 2, 1, 1, 1).data,
    ctx.getImageData(1, height - 2, 1, 1).data,
    ctx.getImageData(width - 2, height - 2, 1, 1).data,
  ];

  const colors = corners.map((d) => ({ r: d[0], g: d[1], b: d[2] }));
  let bestColor = colors[0];
  let bestCount = 0;

  for (const candidate of colors) {
    const count = colors.filter((c) => colorDistance(c, candidate) <= BG_TOLERANCE).length;
    if (count > bestCount) {
      bestCount = count;
      bestColor = candidate;
    }
  }

  return bestColor;
}

/** Draw image to canvas and remove background pixels within tolerance of bgColor */
export function prepareCanvas(
  img: HTMLImageElement,
  bgColor?: BgColor
): { canvas: HTMLCanvasElement; bgColor: BgColor } {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const detectedColor = bgColor ?? detectBgColor(canvas);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const dist = colorDistance(
      { r: data[i], g: data[i + 1], b: data[i + 2] },
      detectedColor
    );
    if (dist <= BG_TOLERANCE) {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return { canvas, bgColor: detectedColor };
}

/** Detect rows of sprites by finding horizontal transparent gaps */
export function detectRows(canvas: HTMLCanvasElement): DetectedRow[] {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const rows: DetectedRow[] = [];
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
      const sprites = detectColumns(canvas, rowStart, y);
      rows.push({
        index: rows.length,
        y1: rowStart,
        y2: y,
        height: y - rowStart,
        sprites,
        frameCount: sprites.length,
      });
      inContent = false;
    }
  }

  if (inContent) {
    const sprites = detectColumns(canvas, rowStart, height);
    rows.push({
      index: rows.length,
      y1: rowStart,
      y2: height,
      height: height - rowStart,
      sprites,
      frameCount: sprites.length,
    });
  }

  return rows;
}

/** Detect individual sprite columns within a row by finding vertical transparent gaps */
function detectColumns(canvas: HTMLCanvasElement, y1: number, y2: number): { x1: number; x2: number; width: number }[] {
  const ctx = canvas.getContext("2d")!;
  const width = canvas.width;
  const cols: { x1: number; x2: number; width: number }[] = [];
  let inContent = false;
  let colStart = 0;

  for (let x = 0; x < width; x++) {
    const colData = ctx.getImageData(x, y1, 1, y2 - y1).data;
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
      cols.push({ x1: colStart, x2: x, width: x - colStart });
      inContent = false;
    }
  }

  if (inContent) {
    cols.push({ x1: colStart, x2: width, width: width - colStart });
  }

  return cols;
}

/** Create a horizontal sprite strip from selected rows, scaled to FRAME_SIZE */
export async function createStrip(
  canvas: HTMLCanvasElement,
  rows: DetectedRow[]
): Promise<ProcessedStrip> {
  const ctx = canvas.getContext("2d")!;

  // Collect all sprite bounding boxes from the selected rows
  const sprites: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const row of rows) {
    for (const col of row.sprites) {
      sprites.push({ x1: col.x1, y1: row.y1, x2: col.x2, y2: row.y2 });
    }
  }

  if (sprites.length === 0) {
    throw new Error("No sprites found in selected rows");
  }

  // Create output strip canvas
  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = FRAME_SIZE * sprites.length;
  stripCanvas.height = FRAME_SIZE;
  const stripCtx = stripCanvas.getContext("2d")!;
  stripCtx.imageSmoothingEnabled = false; // pixelated scaling

  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    const sw = s.x2 - s.x1;
    const sh = s.y2 - s.y1;

    // Get tight bounding box of actual content
    const spriteData = ctx.getImageData(s.x1, s.y1, sw, sh);
    const bbox = getTightBBox(spriteData);
    if (!bbox) continue;

    const cropW = bbox.x2 - bbox.x1;
    const cropH = bbox.y2 - bbox.y1;
    const scale = Math.min(FRAME_SIZE / cropW, FRAME_SIZE / cropH);
    const scaledW = Math.round(cropW * scale);
    const scaledH = Math.round(cropH * scale);
    const ox = Math.round((FRAME_SIZE - scaledW) / 2);
    const oy = Math.round((FRAME_SIZE - scaledH) / 2);

    // Draw the cropped sprite scaled into the frame
    stripCtx.drawImage(
      canvas,
      s.x1 + bbox.x1, s.y1 + bbox.y1, cropW, cropH,
      i * FRAME_SIZE + ox, oy, scaledW, scaledH
    );
  }

  // Export as PNG blob
  const blob = await canvasToUint8Array(stripCanvas);
  return { blob, frames: sprites.length };
}

/** Get tight bounding box of non-transparent pixels in ImageData */
function getTightBBox(imageData: ImageData): { x1: number; y1: number; x2: number; y2: number } | null {
  const { width, height, data } = imageData;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  return found ? { x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1 } : null;
}

/** Convert canvas to PNG Uint8Array */
function canvasToUint8Array(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Failed to create blob"));
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
    }, "image/png");
  });
}

/** Generate a small preview image of a detected row */
export function getRowPreview(canvas: HTMLCanvasElement, row: DetectedRow, maxHeight: number = 48): string {
  const previewCanvas = document.createElement("canvas");
  const scale = maxHeight / row.height;
  const previewWidth = Math.round(canvas.width * scale);
  previewCanvas.width = previewWidth;
  previewCanvas.height = maxHeight;
  const ctx = previewCanvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, row.y1, canvas.width, row.height, 0, 0, previewWidth, maxHeight);
  return previewCanvas.toDataURL("image/png");
}
