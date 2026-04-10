#!/usr/bin/env python3
"""Extract individual sprite frames from a sprite sheet.

Usage:
    python3 scripts/extract_sprites.py <input_image> <output_dir> [options]

Examples:
    python3 scripts/extract_sprites.py ~/Downloads/Charlotte.gif src/assets/sprites/sample/Charlotte
    python3 scripts/extract_sprites.py sheet.png out/ --min-gap 8 --min-size 20 --no-clean
"""

import argparse, math, os, sys
from PIL import Image

DEFAULTS = {
    "bg_tolerance": 30,
    "alpha_threshold": 10,
    "min_gap": 5,
    "min_region_width": 10,
    "min_frame_size": 12,
}


def color_dist(a: tuple, b: tuple) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def detect_bg(img: Image.Image) -> tuple:
    """Detect background color by majority vote of the 4 corner pixels."""
    w, h = img.size
    samples = [
        img.getpixel((1, 1)),
        img.getpixel((w - 2, 1)),
        img.getpixel((1, h - 2)),
        img.getpixel((w - 2, h - 2)),
    ]
    colors = [c[:3] for c in samples]
    best, best_n = colors[0], 0
    for cand in colors:
        n = sum(1 for c in colors if color_dist(c, cand) <= DEFAULTS["bg_tolerance"])
        if n > best_n:
            best_n = n
            best = cand
    return best


def remove_bg(img: Image.Image, bg: tuple, tol: int) -> Image.Image:
    """Set pixels within tolerance of bg color to fully transparent."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if color_dist((r, g, b), bg) <= tol:
                px[x, y] = (r, g, b, 0)
    return img


def detect_rows(img: Image.Image, alpha_thresh: int) -> list:
    """Find horizontal bands of non-transparent content."""
    w, h = img.size
    px = img.load()
    rows, in_c, start = [], False, 0
    for y in range(h):
        has = any(px[x, y][3] > alpha_thresh for x in range(w))
        if has and not in_c:
            start, in_c = y, True
        elif not has and in_c:
            rows.append((start, y))
            in_c = False
    if in_c:
        rows.append((start, h))
    return rows


def detect_columns(img: Image.Image, y1: int, y2: int,
                   alpha_thresh: int, min_gap: int, min_width: int) -> list:
    """Find vertical content regions within a row, bridging tiny gaps
    and absorbing narrow slivers."""
    w = img.size[0]
    px = img.load()

    # Pass 1: raw content regions
    raw = []
    in_c, start = False, 0
    for x in range(w):
        has = any(px[x, y][3] > alpha_thresh for y in range(y1, y2))
        if has and not in_c:
            start, in_c = x, True
        elif not has and in_c:
            raw.append([start, x])
            in_c = False
    if in_c:
        raw.append([start, w])
    if not raw:
        return []

    # Pass 2: bridge gaps smaller than min_gap
    merged = [list(raw[0])]
    for i in range(1, len(raw)):
        gap = raw[i][0] - merged[-1][1]
        if gap < min_gap:
            merged[-1][1] = raw[i][1]
        else:
            merged.append(list(raw[i]))

    # Pass 3: absorb slivers narrower than min_width into nearest neighbor
    changed = True
    while changed:
        changed = False
        for i in range(len(merged)):
            if merged[i][1] - merged[i][0] < min_width and len(merged) > 1:
                if i == 0:
                    merged[1][0] = merged[i][0]
                elif i == len(merged) - 1:
                    merged[i - 1][1] = merged[i][1]
                else:
                    gl = merged[i][0] - merged[i - 1][1]
                    gr = merged[i + 1][0] - merged[i][1]
                    if gl <= gr:
                        merged[i - 1][1] = merged[i][1]
                    else:
                        merged[i + 1][0] = merged[i][0]
                merged.pop(i)
                changed = True
                break

    return [(r[0], r[1]) for r in merged]


def tight_bbox(img: Image.Image, x1: int, y1: int, x2: int, y2: int,
               alpha_thresh: int):
    """Tight bounding box of non-transparent pixels in a region."""
    px = img.load()
    mnx, mny, mxx, mxy = x2, y2, x1, y1
    found = False
    for y in range(y1, y2):
        for x in range(x1, x2):
            if px[x, y][3] > alpha_thresh:
                mnx, mny = min(mnx, x), min(mny, y)
                mxx, mxy = max(mxx, x), max(mxy, y)
                found = True
    return (mnx, mny, mxx + 1, mxy + 1) if found else None


def main():
    parser = argparse.ArgumentParser(
        description="Extract individual sprite frames from a sprite sheet."
    )
    parser.add_argument("input", help="Path to sprite sheet image")
    parser.add_argument("output", help="Output directory for frame PNGs")
    parser.add_argument("--bg", help="Background color as R,G,B (auto-detect if omitted)")
    parser.add_argument("--bg-tolerance", type=int, default=DEFAULTS["bg_tolerance"],
                        help=f"Color distance tolerance for bg removal (default: {DEFAULTS['bg_tolerance']})")
    parser.add_argument("--min-gap", type=int, default=DEFAULTS["min_gap"],
                        help=f"Gaps smaller than this are bridged (default: {DEFAULTS['min_gap']})")
    parser.add_argument("--min-region", type=int, default=DEFAULTS["min_region_width"],
                        help=f"Regions narrower than this merge into neighbor (default: {DEFAULTS['min_region_width']})")
    parser.add_argument("--min-size", type=int, default=DEFAULTS["min_frame_size"],
                        help=f"Discard frames smaller than NxN (default: {DEFAULTS['min_frame_size']})")
    parser.add_argument("--no-clean", action="store_true",
                        help="Keep all frames including tiny/text artifacts")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"Error: {args.input} not found", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)
    img = Image.open(args.input).convert("RGBA")
    print(f"Image: {img.size[0]}x{img.size[1]}")

    if args.bg:
        bg = tuple(int(c) for c in args.bg.split(","))
    else:
        bg = detect_bg(img)
    print(f"Background: RGB{bg}")

    img = remove_bg(img, bg, args.bg_tolerance)
    rows = detect_rows(img, DEFAULTS["alpha_threshold"])
    print(f"Detected {len(rows)} rows\n")

    all_frames = []
    for ri, (y1, y2) in enumerate(rows):
        cols = detect_columns(img, y1, y2,
                              DEFAULTS["alpha_threshold"], args.min_gap, args.min_region)
        row_label = f"Row {ri + 1:2d} (y={y1:4d}-{y2:4d}, h={y2 - y1:3d})"

        row_frames = []
        for x1, x2 in cols:
            bbox = tight_bbox(img, x1, y1, x2, y2, DEFAULTS["alpha_threshold"])
            if not bbox:
                continue
            bx1, by1, bx2, by2 = bbox
            fw, fh = bx2 - bx1, by2 - by1

            # Skip noise/junk frames unless --no-clean
            if not args.no_clean and (fw < args.min_size and fh < args.min_size):
                continue

            cropped = img.crop((bx1, by1, bx2, by2))
            row_frames.append((cropped, fw, fh))

        print(f"{row_label}: {len(row_frames)} frames")
        all_frames.extend(row_frames)

    # Save with sequential numbering
    for i, (cropped, fw, fh) in enumerate(all_frames, 1):
        fname = f"frame_{i:03d}.png"
        cropped.save(os.path.join(args.output, fname))
        print(f"  {fname}: {fw:3d}x{fh:3d}")

    print(f"\nTotal: {len(all_frames)} frames → {args.output}")


if __name__ == "__main__":
    main()
