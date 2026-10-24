#!/usr/bin/env python3
"""Recolour the OG Sync (fitness) artwork into the HoloCity palette for lite.

Shapes are untouched: every static OG layer is composited exactly as
`src/screens/FitnessScreen.tsx` draws it (same artboard positions, the same
luminance masks, the same vector panels), then only colours are remapped:

* OG yellow background            -> mid navy (`theme.ogSync.ground`)
* OG darker-yellow stripe art      -> a darker navy stripe (`theme.ogSync.stripe`)
* the thin yellow seams the OG art
  shows *between and inside* its
  black panels (frame lines, ticks,
  cut-outs)                         -> cyan accent (`theme.colors.accent`)
* black panels                     -> near-black navy (`theme.ogSync.panel`), shading kept by luminance
* yellow art (swap arrows)         -> cyan accent

Dynamic pieces (texts, goal/EXP bars, needle, reward icons, GO label) stay
vector/original in the screen. Originals in assets/figma/fitness are never
modified; output goes to assets/figma/fitness-lite/.

Usage: python3 scripts/recolor_og_fitness.py   (from mobile/; needs Pillow, numpy, scipy)
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "assets", "figma", "fitness")
OUT = os.path.join(HERE, "..", "assets", "figma", "fitness-lite")
W, H = 1800, 3200
OUT_SCALE = 0.75  # 1350x2400: >= 3x of the widest phone canvas (402 pt)

# src/lite/theme.ts tokens (kept in sync by src/lite/config/__tests__/ogSyncArt.test.ts)
BG = "#1B4257"       # theme.ogSync.ground
STRIPE = "#14354A"   # theme.ogSync.stripe (OG stripes are a darker shade of the ground)
PANEL = "#05080F"    # theme.ogSync.panel (OG black panels: near-black, well below the ground)
ACCENT = "#62DDE8"   # theme.colors.accent
STRIPE_ALPHA = 1.0
SEAM_RADIUS = 25  # artboard px: background no wider than ~2x this between panels is a seam (OG seams ~30 px)
SEAM_HUG = 40     # artboard px: a seam pixel also lies within this of a panel, so channel mouths stay square


def rgb(hex_: str) -> np.ndarray:
    return np.array([int(hex_[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def layer(name: str) -> Image.Image:
    return Image.open(os.path.join(SRC, f"{name}.png")).convert("RGBA")


def place(canvas: Image.Image, img: Image.Image, x: int, y: int, w: int, h: int) -> None:
    img = img.resize((w, h), Image.LANCZOS) if img.size != (w, h) else img
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tmp.paste(img, (x, y))
    canvas.alpha_composite(tmp)


def masked(name: str, mask: str, x: int, y: int, w: int, h: int) -> Image.Image:
    """An OG <Image mask=...>: the fill placed on the artboard, alpha * mask luminance."""
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    img = layer(name)
    img = img.resize((w, h), Image.LANCZOS) if img.size != (w, h) else img
    tmp.paste(img, (x, y))
    lum = np.asarray(layer(mask).convert("L").resize((W, H)), dtype=np.float32) / 255.0
    arr = np.asarray(tmp, dtype=np.float32).copy()
    arr[..., 3] *= lum
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def compose_foreground() -> Image.Image:
    """Every static OG layer above the background, in OG draw order."""
    fg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    place(fg, layer("syncPointBar"), 0, 101, 1747, 237)
    place(fg, layer("syncPointAccent"), 0, 337, 892, 166)
    fg.alpha_composite(masked("goalFill", "goalMask", 35, 537, 914, 267))
    draw = ImageDraw.Draw(fg)
    draw.polygon([(40, 835), (705, 835), (705, 1068), (545, 1210), (40, 1210)], fill=(2, 3, 3, 255))
    draw.polygon([(838, 1091), (1700, 1091), (1648, 1204), (785, 1204)], fill=(2, 3, 3, 255))
    place(fg, layer("changeIconBack"), 1533, 1012, 169, 160)
    place(fg, layer("changeIconFront"), 1514, 993, 218, 211)
    fg.alpha_composite(masked("speedometerFill", "speedometerMask", 406, 1265, 954, 954))
    fg.alpha_composite(masked("distanceFill", "distanceMask", 92, 1915, 1639, 385))
    place(fg, layer("bottomElement"), 0, 2208, 1800, 992)
    place(fg, layer("goButton"), 20, 2606, 1695, 446)
    return fg


def recolour() -> Image.Image:
    fg = np.asarray(compose_foreground(), dtype=np.float32)
    alpha = fg[..., 3] / 255.0
    solid = alpha > 0.5

    # Seams: background pixels the OG design encloses in thin gaps between/inside panels.
    disk = np.hypot(*np.mgrid[-SEAM_RADIUS:SEAM_RADIUS + 1, -SEAM_RADIUS:SEAM_RADIUS + 1]) <= SEAM_RADIUS
    seams = ndimage.binary_closing(solid, structure=disk) & ~solid
    # ...and the thin channels the OG leaves between neighbouring panels (open at the
    # ends, so closing misses them): background narrower than the disk. The artboard
    # edge counts as open background, never as a wall.
    pad = SEAM_RADIUS + 2
    bg = np.pad(~solid, pad, constant_values=True)
    # A square (not a disk) keeps channel mouths square-cut, like the OG panel edges.
    square = np.ones((2 * SEAM_RADIUS + 1, 2 * SEAM_RADIUS + 1), dtype=bool)
    bg_open = ndimage.binary_opening(bg, structure=square)[pad:-pad, pad:-pad]
    hug = ndimage.distance_transform_edt(~solid) <= SEAM_HUG
    seams |= ~solid & ~bg_open & hug

    # Background: OG base + stripes, recoloured.
    stripes = np.asarray(layer("backgroundDesign"), dtype=np.float32)[..., 3:4] / 255.0
    out = rgb(BG)[None, None, :] * (1 - stripes * STRIPE_ALPHA) + rgb(STRIPE)[None, None, :] * stripes * STRIPE_ALPHA
    out = np.broadcast_to(out, (H, W, 3)).copy()
    # Soften the seam edge so it antialiases like the OG cut-out did.
    seam_soft = ndimage.gaussian_filter(seams.astype(np.float32), 0.8)
    out = out * (1 - seam_soft[..., None]) + rgb(ACCENT)[None, None, :] * seam_soft[..., None]

    # Foreground: duotone by luminance (black -> keycap navy, light -> accent),
    # saturated warm art (the yellow swap arrows) -> accent at its own brightness.
    col = fg[..., :3]
    lum = (0.2126 * col[..., 0] + 0.7152 * col[..., 1] + 0.0722 * col[..., 2]) / 255.0
    mx, mn = col.max(-1), col.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    warm = (sat > 0.45) & (col[..., 0] >= col[..., 2]) & (mx > 90)
    duo = rgb(PANEL)[None, None, :] + lum[..., None] * (rgb(ACCENT) - rgb(PANEL))[None, None, :]
    accent = rgb(ACCENT)[None, None, :] * np.clip(mx / 240.0, 0, 1)[..., None]
    fgc = np.where(warm[..., None], accent, duo)
    out = out * (1 - alpha[..., None]) + fgc * alpha[..., None]

    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    return img.resize((int(W * OUT_SCALE), int(H * OUT_SCALE)), Image.LANCZOS)


def recolour_needle() -> Image.Image:
    """Needle keeps its shape; yellow -> accent, its dark hub stays dark."""
    arr = np.asarray(layer("speedometerNeedle"), dtype=np.float32).copy()
    col = arr[..., :3]
    mx = col.max(-1)
    t = np.clip(mx / 240.0, 0, 1)[..., None]
    arr[..., :3] = rgb(PANEL)[None, None, :] * (1 - t) + rgb(ACCENT)[None, None, :] * t
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    recolour().save(os.path.join(OUT, "syncArtHoloCity.png"), optimize=True)
    recolour_needle().save(os.path.join(OUT, "speedometerNeedleHoloCity.png"), optimize=True)
    print("wrote", OUT)
