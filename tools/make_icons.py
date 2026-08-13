#!/usr/bin/env python3
"""Generate the PWA's PNG icons.

Pure standard library — no Pillow — so a detachment can regenerate the icon set
on any machine with Python 3 installed. Shapes are drawn with signed-distance
functions and 4x supersampling, which gives clean antialiased edges without a
raster library.

    python3 tools/make_icons.py

Writes icons/icon-192.png, icon-512.png, icon-180.png and icon-maskable-512.png.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"

# Matches --accent in css/styles.css (light theme).
NAVY = (28, 79, 139)
WHITE = (255, 255, 255)
SUPERSAMPLE = 4


def rounded_rect_sdf(x: float, y: float, half_w: float, half_h: float, radius: float) -> float:
    """Signed distance to a rounded rectangle centred on the origin."""
    dx = abs(x) - (half_w - radius)
    dy = abs(y) - (half_h - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def segment_sdf(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """Signed distance to the line segment ab."""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length_sq = vx * vx + vy * vy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / length_sq))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def render(size: int, maskable: bool) -> bytes:
    """Render one icon and return raw RGB bytes (size * size * 3)."""
    scale = size * SUPERSAMPLE
    # A maskable icon must survive an aggressive circular crop, so the artwork
    # sits inside the safe zone (80% of the canvas) and the background bleeds
    # to every edge.
    art_scale = 0.62 if maskable else 0.80
    corner = 0.5 if maskable else 0.22  # 0.5 => full circle-ish for maskable bleed

    half = scale / 2.0
    bg_half = half if maskable else half * 0.94
    radius = bg_half * 2 * corner
    stroke = scale * 0.075

    # Check mark, in units where the icon spans -1..1 with y pointing up:
    # down-stroke into the elbow, then a longer up-stroke.
    check = [(-0.44, 0.04), (-0.14, -0.28), (0.44, 0.34)]
    points = [(x * scale * art_scale / 2, y * scale * art_scale / 2) for x, y in check]

    rows = bytearray()
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r_acc = g_acc = b_acc = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = (px * SUPERSAMPLE + sx) + 0.5 - half
                    y = (py * SUPERSAMPLE + sy) + 0.5 - half

                    inside_bg = rounded_rect_sdf(x, y, bg_half, bg_half, radius) <= 0
                    if not inside_bg:
                        # Transparent corners are flattened to white so the PNG
                        # stays RGB; Android masks these away anyway.
                        colour = WHITE
                    else:
                        d = min(
                            segment_sdf(x, -y, *points[0], *points[1]),
                            segment_sdf(x, -y, *points[1], *points[2]),
                        )
                        colour = WHITE if d <= stroke / 2 else NAVY
                    r_acc += colour[0]
                    g_acc += colour[1]
                    b_acc += colour[2]

            samples = SUPERSAMPLE * SUPERSAMPLE
            row += bytes((r_acc // samples, g_acc // samples, b_acc // samples))
        rows += b"\x00" + row  # PNG filter type 0 per scanline
    return bytes(rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"  {path.relative_to(ROOT)}  ({len(png):,} bytes)")


def main() -> None:
    ICON_DIR.mkdir(exist_ok=True)
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-180.png", 180, False),
        ("icon-maskable-512.png", 512, True),
    ]
    print("Generating icons…")
    for name, size, maskable in targets:
        write_png(ICON_DIR / name, size, render(size, maskable))
    print("Done.")


if __name__ == "__main__":
    main()
