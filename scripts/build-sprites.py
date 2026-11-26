"""Supersampled 256x256 anime-chibi nekomi catgirl sprite & 24x24 helper kitten generator."""

from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw

FRAMES = [
    "idle_0", "idle_1",
    "walk_0", "walk_1",
    "code_0", "code_1",
    "term_0", "term_1",
    "read_0", "read_1",
    "happy_0", "happy_1",
    "sleep_0", "sleep_1",
    "oops_0", "oops_1",
    "type_0", "type_1",
]
MASTER_SIZE = 256
PNG_SIZE = 128
SIXEL_SIZE = 96
MAX_SIXEL_COLORS = 64

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "sprites"

# Refined anime cel-shaded palette for nekomi catgirl design
COL = {
    "OUT": (58, 42, 107, 255),       # #3a2a6b delicate dark violet-indigo lineart
    "OUT_S": (86, 66, 146, 220),     # softer inner detail lineart
    "SKIN": (255, 241, 234, 255),    # #fff1ea luminous anime skin
    "SKIN_S": (246, 212, 200, 255),  # #f6d4c8 warm cel shade
    "BLUSH": (255, 186, 206, 255),   # opaque peach-pink blush blended over skin (no dark terminal bleed)
    "MOUTH": (176, 98, 126, 255),    # delicate anime mouth line
    "EAR_O": (122, 144, 255, 255),   # matches periwinkle hair crown seamlessly
    "EAR_SH": (98, 114, 226, 255),   # soft outer ear shadow
    "EAR_W": (255, 250, 255, 255),   # fluffy cream-white ear tuft
    "EAR_P": (236, 168, 218, 255),   # soft pastel rose-lavender ear hollow
    "H_HI": (208, 226, 255, 210),    # silky anime hair highlight
    "WHT": (255, 255, 255, 255),
    "KIM_D": (42, 34, 96, 255),      # dark navy kimono
    "KIM_M": (70, 58, 152, 255),     # indigo trim/fold
    "SAS": (138, 92, 236, 255),      # violet obi sash
    "SAS_L": (188, 148, 255, 255),
    "FRIL": (248, 246, 255, 255),    # white petticoat / cuffs / loose socks
    "FRIL_S": (212, 206, 242, 255),
    "SHOE": (52, 40, 112, 255),
    "SOLE_B": (144, 180, 255, 255),
    "SOLE_P": (214, 142, 255, 255),
    "STAR_C": (150, 240, 255, 255),
    "STAR_V": (206, 166, 255, 255),
    "STAR_G": (255, 242, 168, 255),
    "HEART": (255, 110, 174, 255),
    "BOOK": (88, 66, 168, 255),
    "RUNE_BG": (28, 26, 66, 255),
    "ZZZ": (138, 180, 255, 255),
    "TEAR": (136, 228, 255, 225),
}

HAIR_STOPS = [
    (0.00, (122, 148, 255)),  # periwinkle-sky crown matching 1.webp
    (0.34, (142, 134, 255)),  # periwinkle mid
    (0.68, (188, 136, 255)),  # lavender
    (1.00, (242, 154, 248)),  # pastel pink-lilac curls
]

TAIL_STOPS = [
    (0.00, (118, 176, 255)),  # sky-blue root
    (0.36, (140, 144, 255)),  # periwinkle
    (0.72, (192, 136, 255)),  # lavender
    (1.00, (244, 158, 250)),  # fluffy pink-lilac tip
]


def catmull_rom(points: list[tuple[float, float]], closed: bool = True, steps: int = 8) -> list[tuple[float, float]]:
    n = len(points)
    if n < 3:
        return points
    out: list[tuple[float, float]] = []
    count = n if closed else n - 1
    for i in range(count):
        p0 = points[(i - 1) % n] if closed else points[max(0, i - 1)]
        p1 = points[i % n]
        p2 = points[(i + 1) % n]
        p3 = points[(i + 2) % n] if closed else points[min(n - 1, i + 2)]
        for s in range(steps):
            t = s / steps
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                (2 * p1[0])
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1])
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            out.append((x, y))
    if not closed:
        out.append(points[-1])
    return out


def lerp_stops(stops: list[tuple[float, tuple[int, int, int]]], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            u = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return (
                round(c0[0] + (c1[0] - c0[0]) * u),
                round(c0[1] + (c1[1] - c0[1]) * u),
                round(c0[2] + (c1[2] - c0[2]) * u),
            )
    return stops[-1][1]


def paint_gradient_mask(mask: Image.Image, y0: float, y1: float, stops: list[tuple[float, tuple[int, int, int]]]) -> Image.Image:
    w, h = mask.size
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gpix = grad.load()
    span = max(1.0, y1 - y0)
    row_colors = [lerp_stops(stops, (y - y0) / span) for y in range(h)]
    mpix = mask.load()
    for y in range(h):
        r, g, b = row_colors[y]
        for x in range(w):
            a = mpix[x, y]
            if a > 0:
                gpix[x, y] = (r, g, b, a)
    return grad


def draw_closed(d: ImageDraw.ImageDraw, pts: list[tuple[float, float]], fill, outline=COL["OUT"], width: int = 3) -> None:
    d.polygon(pts, fill=fill)
    if outline and width > 0:
        d.line(pts + [pts[0]], fill=outline, width=width, joint="curve")


def draw_star(d: ImageDraw.ImageDraw, cx: float, cy: float, rx: float, ry: float, bright: bool = False) -> None:
    """Delicate 4-pointed iridescent Gemini star from 1.webp."""
    ix = rx * 0.28
    iy = ry * 0.28
    top = (cx, cy - ry)
    right = (cx + rx, cy)
    bot = (cx, cy + ry)
    left = (cx - rx, cy)
    tr = (cx + ix, cy - iy)
    br = (cx + ix, cy + iy)
    bl = (cx - ix, cy + iy)
    tl = (cx - ix, cy - iy)
    center = (cx, cy)

    outline_pts = [top, tr, right, br, bot, bl, left, tl]
    d.polygon([center, top, tr], fill=COL["WHT"] if bright else COL["STAR_C"])
    d.polygon([center, tr, right], fill=COL["STAR_G"])
    d.polygon([center, right, br], fill=COL["STAR_C"])
    d.polygon([center, br, bot], fill=COL["STAR_V"])
    d.polygon([center, bot, bl], fill=COL["STAR_C"])
    d.polygon([center, bl, left], fill=COL["STAR_V"])
    d.polygon([center, left, tl], fill=COL["WHT"] if bright else COL["STAR_C"])
    d.polygon([center, tl, top], fill=COL["WHT"])
    d.line(outline_pts + [outline_pts[0]], fill=COL["OUT"], width=2, joint="curve")
    d.ellipse((cx - ix * 0.65, cy - iy * 0.65, cx + ix * 0.65, cy + iy * 0.65), fill=COL["WHT"])


def draw_heart(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    pts = catmull_rom(
        [
            (cx, cy + r * 0.95),
            (cx - r * 1.15, cy + r * 0.05),
            (cx - r * 0.95, cy - r * 0.75),
            (cx - r * 0.35, cy - r * 0.72),
            (cx, cy - r * 0.32),
            (cx + r * 0.35, cy - r * 0.72),
            (cx + r * 0.95, cy - r * 0.75),
            (cx + r * 1.15, cy + r * 0.05),
        ],
        steps=6,
    )
    draw_closed(d, pts, COL["HEART"], COL["OUT"], width=2)
    d.ellipse((cx - r * 0.60, cy - r * 0.46, cx - r * 0.24, cy - r * 0.14), fill=COL["WHT"])


def draw_tapered_tail(canvas: Image.Image, frame: str, dy: int) -> None:
    """Lush plush S-curved gradient cat tail matching 1.webp."""
    if frame.startswith("sleep"):
        spine = [(98, 202), (76, 214), (50, 218), (32, 208), (28, 188), (38, 174)]
        radii = [11, 14, 16, 16, 14, 10]
    elif frame.startswith("oops"):
        sway = 5 if frame == "oops_1" else 0
        spine = [(92, 184 + dy), (62, 176 + dy), (42, 154 + dy), (34 + sway, 126 + dy), (40 + sway, 98 + dy)]
        radii = [12, 16, 19, 18, 12]
    elif frame in ("happy_0", "happy_1", "walk_0", "code_0", "code_1", "type_0"):
        lift = -6 if frame in ("happy_1", "code_1") else 0
        spine = [(94, 184 + dy), (66, 188 + dy), (40, 178 + dy + lift), (28, 152 + dy + lift), (36, 128 + dy + lift)]
        radii = [11, 15, 17, 16, 10]
    elif frame in ("idle_1", "walk_1", "type_1", "term_1"):
        spine = [(94, 186 + dy), (68, 196 + dy), (42, 196 + dy), (26, 176 + dy), (32, 152 + dy)]
        radii = [11, 15, 17, 16, 10]
    else:
        spine = [(94, 186 + dy), (66, 202 + dy), (38, 208 + dy), (24, 188 + dy), (30, 164 + dy)]
        radii = [11, 15, 17, 16, 10]

    smooth = catmull_rom(spine, closed=False, steps=8)
    mask = Image.new("L", canvas.size, 0)
    md = ImageDraw.Draw(mask)
    out_mask = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(out_mask)

    n = len(smooth)
    for idx, (x, y) in enumerate(smooth):
        u = idx / max(1, n - 1)
        f_idx = u * (len(radii) - 1)
        i0 = min(len(radii) - 2, int(f_idx))
        t = f_idx - i0
        r = radii[i0] * (1 - t) + radii[i0 + 1] * t
        if frame.startswith("oops") and idx % 5 == 2:
            r += 3.0
        od.ellipse((x - r - 2.5, y - r - 2.5, x + r + 2.5, y + r + 2.5), fill=COL["OUT"])
        md.ellipse((x - r, y - r, x + r, y + r), fill=255)

    canvas.alpha_composite(out_mask)
    ys = [p[1] for p in spine]
    grad = paint_gradient_mask(mask, min(ys) - 14, max(ys) + 14, TAIL_STOPS)
    canvas.alpha_composite(grad)


def draw_anime_eye(
    canvas: Image.Image,
    cx: float,
    cy: float,
    iris_stops: list[tuple[float, tuple[int, int, int]]],
    mode: str,
) -> None:
    """Delicate 1.webp anime eye: graceful upper eyelash, luminous iris, NO heavy full-circle black outline."""
    d = ImageDraw.Draw(canvas, "RGBA")
    if mode == "happy":
        arc_pts = catmull_rom([(cx - 12, cy + 5), (cx - 4, cy - 4), (cx + 4, cy - 4), (cx + 12, cy + 5)], closed=False, steps=6)
        d.line(arc_pts, fill=COL["OUT"], width=4, joint="curve")
        return
    if mode == "sleep":
        arc_pts = catmull_rom([(cx - 12, cy + 2), (cx - 4, cy + 6), (cx + 4, cy + 6), (cx + 12, cy + 2)], closed=False, steps=6)
        d.line(arc_pts, fill=COL["OUT"], width=3, joint="curve")
        return

    rx, ry = (11.5, 13.0) if mode != "oops" else (12.0, 14.0)
    # Soft almond sclera
    d.ellipse((cx - rx - 3, cy - ry + 2, cx + rx + 3, cy + ry + 1), fill=COL["WHT"])

    cy_i = cy + 3 if mode == "read" else cy
    ry_i = ry - 2.5 if mode == "read" else ry

    # Luminous iris gradient clipped cleanly
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy_i - ry_i, cx + rx, cy_i + ry_i), fill=255)
    iris_img = paint_gradient_mask(mask, cy_i - ry_i, cy_i + ry_i, iris_stops)
    canvas.alpha_composite(iris_img)

    d = ImageDraw.Draw(canvas, "RGBA")
    # Soft pupil & subtle iris edge tint (no harsh black circle around bottom!)
    if mode == "oops":
        d.ellipse((cx - 3.2, cy_i - 4.2, cx + 3.2, cy_i + 4.2), fill=COL["OUT"])
    else:
        d.ellipse((cx - 4.2, cy_i - 5.2, cx + 4.2, cy_i + 5.6), fill=COL["OUT"])
    d.arc((cx - rx, cy_i - ry_i, cx + rx, cy_i + ry_i), 15, 165, fill=COL["OUT_S"], width=1)

    # Graceful arched upper eyelash with delicate outer wing
    lash_y = cy - ry + (4 if mode == "read" else 0)
    lash = catmull_rom(
        [(cx - rx - 3, lash_y + 7), (cx - 5, lash_y), (cx + 5, lash_y), (cx + rx + 4, lash_y + 6)],
        closed=False,
        steps=6,
    )
    d.line(lash, fill=COL["OUT"], width=4, joint="curve")
    # Tiny lower lash whisper
    d.arc((cx - 7, cy + ry - 3, cx + 7, cy + ry + 2), 20, 160, fill=COL["OUT_S"], width=1)

    # Crisp double specular highlights
    d.ellipse((cx - 8, cy_i - 8, cx - 1.5, cy_i - 1.5), fill=COL["WHT"])
    d.ellipse((cx + 3, cy_i + 4, cx + 6.5, cy_i + 7.5), fill=COL["WHT"])


def draw_cat_ears(canvas: Image.Image, frame: str, dy: int) -> None:
    """Wide-based plush curved anime cat ears seamlessly emerging from the hair crown (not antennae!)."""
    d = ImageDraw.Draw(canvas, "RGBA")
    if frame.startswith("oops"):
        # Startled flattened wide cat ears with open seamless base
        l_fill = [(96, 62 + dy), (72, 48 + dy), (48, 52 + dy), (68, 68 + dy), (92, 72 + dy)]
        l_in = catmull_rom([(88, 62 + dy), (70, 54 + dy), (56, 56 + dy), (72, 66 + dy)], steps=4)
        r_fill = [(160, 62 + dy), (184, 48 + dy), (208, 52 + dy), (188, 68 + dy), (164, 72 + dy)]
        r_in = catmull_rom([(168, 62 + dy), (186, 54 + dy), (200, 56 + dy), (184, 66 + dy)], steps=4)
        d.polygon(l_fill, fill=COL["EAR_O"])
        d.line(catmull_rom([(92, 72 + dy), (68, 68 + dy), (48, 52 + dy), (72, 48 + dy), (96, 58 + dy)], closed=False, steps=5), fill=COL["OUT"], width=3, joint="curve")
        draw_closed(d, l_in, COL["EAR_P"], None, 0)
        d.polygon(r_fill, fill=COL["EAR_O"])
        d.line(catmull_rom([(160, 58 + dy), (184, 48 + dy), (208, 52 + dy), (188, 68 + dy), (164, 72 + dy)], closed=False, steps=5), fill=COL["OUT"], width=3, joint="curve")
        draw_closed(d, r_in, COL["EAR_P"], None, 0)
        return

    ear_dy = dy + (5 if frame.startswith("sleep") else (-2 if frame.startswith(("happy", "code", "term", "type")) else 0))

    # Left plush wide-based cat ear (base width ~38px from x=74..112, tip gently upright at x=80, y=18)
    l_shape = [(73, 62 + ear_dy), (73, 38 + ear_dy), (80, 17 + ear_dy), (99, 28 + ear_dy), (112, 46 + ear_dy), (94, 58 + ear_dy)]
    l_edge = catmull_rom([(73, 62 + ear_dy), (73, 38 + ear_dy), (80, 17 + ear_dy), (99, 28 + ear_dy), (112, 46 + ear_dy)], closed=False, steps=5)
    l_in_w = catmull_rom([(79, 58 + ear_dy), (78, 39 + ear_dy), (83, 25 + ear_dy), (96, 36 + ear_dy), (104, 47 + ear_dy), (91, 52 + ear_dy)], steps=4)
    l_in_p = catmull_rom([(83, 55 + ear_dy), (83, 42 + ear_dy), (87, 36 + ear_dy), (96, 43 + ear_dy), (94, 53 + ear_dy)], steps=4)

    d.polygon(l_shape, fill=COL["EAR_O"])
    d.line(l_edge, fill=COL["OUT"], width=3, joint="curve")
    draw_closed(d, l_in_w, COL["EAR_W"], None, 0)
    # Fluffy white ear tuft fur overlapping inner edge (just like 1.webp!)
    d.polygon([(94, 46 + ear_dy), (105, 42 + ear_dy), (98, 52 + ear_dy)], fill=COL["EAR_W"])
    draw_closed(d, l_in_p, COL["EAR_P"], None, 0)

    # Right plush wide-based cat ear (gentle outer-tip bend on idle_1)
    if frame == "idle_1":
        r_shape = [(144, 46 + ear_dy), (166, 32 + ear_dy), (192, 31 + ear_dy), (186, 52 + ear_dy), (179, 64 + ear_dy), (160, 56 + ear_dy)]
        r_edge = catmull_rom([(144, 46 + ear_dy), (166, 32 + ear_dy), (192, 31 + ear_dy), (186, 52 + ear_dy), (179, 64 + ear_dy)], closed=False, steps=5)
        r_in_w = catmull_rom([(152, 48 + ear_dy), (167, 38 + ear_dy), (184, 37 + ear_dy), (179, 52 + ear_dy), (167, 54 + ear_dy)], steps=4)
        d.polygon(r_shape, fill=COL["EAR_O"])
        d.line(r_edge, fill=COL["OUT"], width=3, joint="curve")
        draw_closed(d, r_in_w, COL["EAR_P"], None, 0)
    else:
        r_shape = [(144, 46 + ear_dy), (157, 28 + ear_dy), (176, 17 + ear_dy), (183, 38 + ear_dy), (183, 62 + ear_dy), (162, 58 + ear_dy)]
        r_edge = catmull_rom([(144, 46 + ear_dy), (157, 28 + ear_dy), (176, 17 + ear_dy), (183, 38 + ear_dy), (183, 62 + ear_dy)], closed=False, steps=5)
        r_in_w = catmull_rom([(152, 47 + ear_dy), (160, 36 + ear_dy), (173, 25 + ear_dy), (178, 39 + ear_dy), (177, 58 + ear_dy), (165, 52 + ear_dy)], steps=4)
        r_in_p = catmull_rom([(160, 43 + ear_dy), (169, 36 + ear_dy), (173, 42 + ear_dy), (173, 55 + ear_dy), (162, 53 + ear_dy)], steps=4)

        d.polygon(r_shape, fill=COL["EAR_O"])
        d.line(r_edge, fill=COL["OUT"], width=3, joint="curve")
        draw_closed(d, r_in_w, COL["EAR_W"], None, 0)
        d.polygon([(151, 42 + ear_dy), (162, 46 + ear_dy), (158, 52 + ear_dy)], fill=COL["EAR_W"])
        draw_closed(d, r_in_p, COL["EAR_P"], None, 0)


def draw_back_hair_and_buns(canvas: Image.Image, dy: int) -> None:
    """Airy layered S-wave gradient hair + soft scalloped twin buns matching 1.webp."""
    l_hair = catmull_rom(
        [(94, 88 + dy), (72, 108 + dy), (56, 140 + dy), (48, 174 + dy), (62, 198 + dy), (76, 194 + dy), (78, 172 + dy), (92, 162 + dy), (102, 134 + dy)],
        steps=6,
    )
    r_hair = catmull_rom(
        [(162, 88 + dy), (184, 108 + dy), (200, 140 + dy), (208, 174 + dy), (194, 198 + dy), (180, 194 + dy), (178, 172 + dy), (164, 162 + dy), (154, 134 + dy)],
        steps=6,
    )
    l_tip2 = catmull_rom([(54, 152 + dy), (40, 174 + dy), (48, 192 + dy), (62, 182 + dy)], steps=5)
    r_tip2 = catmull_rom([(202, 152 + dy), (216, 174 + dy), (208, 192 + dy), (194, 182 + dy)], steps=5)

    mask = Image.new("L", canvas.size, 0)
    md = ImageDraw.Draw(mask)
    for poly in (l_hair, r_hair, l_tip2, r_tip2):
        md.polygon(poly, fill=255)
    # Soft triple-puff scalloped braided buns tucked cleanly beneath cat ears
    for bx, by, br in ((64, 66 + dy, 12), (56, 75 + dy, 10), (70, 78 + dy, 9), (192, 66 + dy, 12), (200, 75 + dy, 10), (186, 78 + dy, 9)):
        md.ellipse((bx - br, by - br, bx + br, by + br), fill=255)

    hair_grad = paint_gradient_mask(mask, 50 + dy, 200 + dy, HAIR_STOPS)
    canvas.alpha_composite(hair_grad)
    d = ImageDraw.Draw(canvas, "RGBA")
    for poly in (l_tip2, r_tip2, l_hair, r_hair):
        d.line(poly + [poly[0]], fill=COL["OUT"], width=2, joint="curve")
    # Delicate inner wave lines on long hair locks
    d.line([(66, 136 + dy), (60, 162 + dy), (66, 184 + dy)], fill=COL["OUT_S"], width=1, joint="curve")
    d.line([(190, 136 + dy), (196, 162 + dy), (190, 184 + dy)], fill=COL["OUT_S"], width=1, joint="curve")
    # Delicate scalloped outlines on outer side of buns
    d.arc((52, 54 + dy, 76, 78 + dy), 110, 270, fill=COL["OUT"], width=2)
    d.arc((46, 65 + dy, 66, 85 + dy), 70, 240, fill=COL["OUT"], width=2)
    d.arc((180, 54 + dy, 204, 78 + dy), -90, 70, fill=COL["OUT"], width=2)
    d.arc((190, 65 + dy, 210, 85 + dy), -60, 110, fill=COL["OUT"], width=2)


def draw_body_and_outfit(canvas: Image.Image, frame: str, dy: int) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")

    # Neck & chest shadow
    d.rectangle((120, 134 + dy, 136, 150 + dy), fill=COL["SKIN"])
    d.ellipse((120, 136 + dy, 136, 144 + dy), fill=COL["SKIN_S"])

    # Legs, white loose socks (泡泡袜), and platform shoes with little dark bows
    if frame.startswith("sleep"):
        for sx, sole_c in ((98, COL["SOLE_B"]), (134, COL["SOLE_P"])):
            d.rounded_rectangle((sx, 198 + dy, sx + 24, 214 + dy), radius=7, fill=COL["FRIL"], outline=COL["OUT"], width=2)
            d.rounded_rectangle((sx - 2, 210 + dy, sx + 26, 224 + dy), radius=5, fill=COL["SHOE"], outline=COL["OUT"], width=2)
            d.rounded_rectangle((sx - 2, 219 + dy, sx + 26, 226 + dy), radius=3, fill=sole_c, outline=COL["OUT"], width=2)
    else:
        if frame == "walk_0":
            legs = [(100, 196 + dy, -5, COL["SOLE_B"], -1), (140, 202 + dy, 4, COL["SOLE_P"], 1)]
        elif frame == "walk_1":
            legs = [(106, 202 + dy, 4, COL["SOLE_B"], -1), (134, 196 + dy, -5, COL["SOLE_P"], 1)]
        else:
            legs = [(103, 198 + dy, 0, COL["SOLE_B"], -1), (137, 198 + dy, 0, COL["SOLE_P"], 1)]

        for lx, ly, l_off, sole_c, side in legs:
            d.rectangle((lx + 2, 186 + dy, lx + 14, ly + 12 + l_off), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            sock_pts = catmull_rom(
                [(lx + 1, ly + 8 + l_off), (lx + 15, ly + 8 + l_off), (lx + 18, ly + 22 + l_off), (lx + 19, ly + 30 + l_off), (lx - 3, ly + 30 + l_off), (lx - 2, ly + 22 + l_off)],
                steps=5,
            )
            draw_closed(d, sock_pts, COL["FRIL"], COL["OUT"], 2)
            d.line([(lx + 1, ly + 20 + l_off), (lx + 15, ly + 20 + l_off)], fill=COL["FRIL_S"], width=2)
            d.rounded_rectangle((lx - 4, ly + 28 + l_off, lx + 20, ly + 40 + l_off), radius=5, fill=COL["SHOE"], outline=COL["OUT"], width=2)
            d.rounded_rectangle((lx - 4, ly + 37 + l_off, lx + 20, ly + 44 + l_off), radius=3, fill=sole_c, outline=COL["OUT"], width=2)
            # Cute dark side bow on platform shoe (signature 1.webp detail)
            bx = (lx - 4) if side == -1 else (lx + 20)
            by = ly + 32 + l_off
            d.polygon([(bx, by), (bx + side * 6, by - 4), (bx + side * 6, by + 4)], fill=COL["KIM_D"], outline=COL["OUT"], width=1)

    # White ruffled petticoat + pleated navy mini-skirt
    petticoat = catmull_rom(
        [(88, 190 + dy), (108, 196 + dy), (128, 194 + dy), (148, 196 + dy), (168, 190 + dy), (156, 174 + dy), (100, 174 + dy)],
        steps=5,
    )
    draw_closed(d, petticoat, COL["FRIL"], COL["OUT"], 2)
    skirt = catmull_rom([(94, 184 + dy), (128, 188 + dy), (162, 184 + dy), (150, 166 + dy), (106, 166 + dy)], steps=4)
    draw_closed(d, skirt, COL["KIM_D"], COL["OUT"], 2)

    # High navy collar + diamond chest cutout + midriff + violet star obi
    d.rounded_rectangle((112, 142 + dy, 144, 150 + dy), radius=4, fill=COL["KIM_D"], outline=COL["OUT"], width=2)
    torso = catmull_rom([(108, 148 + dy), (148, 148 + dy), (146, 168 + dy), (110, 168 + dy)], steps=4)
    draw_closed(d, torso, COL["KIM_D"], COL["OUT"], 2)
    d.polygon([(128, 149 + dy), (138, 158 + dy), (128, 164 + dy), (118, 158 + dy)], fill=COL["FRIL"])
    d.polygon([(128, 152 + dy), (134, 158 + dy), (128, 162 + dy), (122, 158 + dy)], fill=COL["STAR_C"])
    d.rectangle((117, 162 + dy, 139, 168 + dy), fill=COL["SKIN"])
    obi = catmull_rom([(106, 166 + dy), (150, 166 + dy), (152, 176 + dy), (104, 176 + dy)], steps=4)
    draw_closed(d, obi, COL["SAS"], COL["OUT"], 2)
    draw_star(d, 128, 171 + dy, 7, 8, bright=True)

    # Detached wide kimono sleeves + arms + pose-specific integrated props
    if frame.startswith("happy"):
        lift = -6 if frame == "happy_1" else 0
        for sx, side in ((92, -1), (164, 1)):
            d.ellipse((sx - 12, 134 + dy + lift, sx + 12, 162 + dy + lift), fill=COL["KIM_D"], outline=COL["OUT"], width=2)
            d.arc((sx - 10, 136 + dy + lift, sx + 10, 148 + dy + lift), 180, 360, fill=COL["FRIL"], width=3)
            px, py = sx + side * 2, 130 + dy + lift
            d.ellipse((px - 8, py - 8, px + 8, py + 8), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            d.ellipse((px - 3, py - 2, px + 3, py + 4), fill=COL["BLUSH"])
    elif frame.startswith("code"):
        l_slv = catmull_rom([(106, 152 + dy), (92, 160 + dy), (88, 184 + dy), (106, 184 + dy)], steps=4)
        draw_closed(d, l_slv, COL["KIM_D"], COL["OUT"], 2)
        d.line([(89, 181 + dy), (105, 181 + dy)], fill=COL["FRIL"], width=3)
        d.ellipse((91, 183 + dy, 103, 194 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)

        lift = -5 if frame == "code_1" else 0
        r_slv = catmull_rom([(150, 150 + dy), (168, 140 + dy + lift), (176, 164 + dy + lift), (156, 170 + dy)], steps=4)
        draw_closed(d, r_slv, COL["KIM_D"], COL["OUT"], 2)
        d.ellipse((168, 136 + dy + lift, 180, 148 + dy + lift), fill=COL["SKIN"], outline=COL["OUT"], width=2)
        d.line([(176, 140 + dy + lift), (206, 104 + dy + lift)], fill=COL["STAR_G"], width=4)
        draw_star(d, 208, 98 + dy + lift, 17, 21, bright=True)
    elif frame.startswith("term"):
        for sx in (96, 160):
            d.ellipse((sx - 10, 150 + dy, sx + 10, 178 + dy), fill=COL["KIM_D"], outline=COL["OUT"], width=2)
        d.rounded_rectangle((96, 152 + dy, 160, 184 + dy), radius=6, fill=COL["RUNE_BG"], outline=COL["STAR_V"], width=2)
        if frame == "term_0":
            d.line([(106, 163 + dy), (132, 163 + dy)], fill=COL["STAR_C"], width=4)
            d.line([(106, 172 + dy), (144, 172 + dy)], fill=COL["STAR_V"], width=3)
            d.ellipse((98, 146 + dy, 110, 158 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            d.ellipse((146, 141 + dy, 158, 153 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
        else:
            d.line([(106, 163 + dy), (146, 163 + dy)], fill=COL["STAR_G"], width=4)
            d.line([(114, 172 + dy), (150, 172 + dy)], fill=COL["STAR_C"], width=3)
            d.ellipse((98, 141 + dy, 110, 153 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            d.ellipse((146, 146 + dy, 158, 158 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
    elif frame.startswith("read"):
        for sx in (98, 158):
            d.ellipse((sx - 10, 150 + dy, sx + 10, 178 + dy), fill=COL["KIM_D"], outline=COL["OUT"], width=2)
        d.rounded_rectangle((96, 158 + dy, 160, 188 + dy), radius=5, fill=COL["BOOK"], outline=COL["OUT"], width=2)
        d.rectangle((102, 162 + dy, 126, 184 + dy), fill=COL["FRIL"])
        d.rectangle((130, 162 + dy, 154, 184 + dy), fill=COL["STAR_C"] if frame == "read_1" else COL["FRIL"])
        d.line([(107, 169 + dy), (121, 169 + dy)], fill=COL["STAR_V"], width=2)
        d.line([(135, 169 + dy), (149, 169 + dy)], fill=COL["STAR_G"], width=2)
    elif frame.startswith("type"):
        for sx in (96, 160):
            d.ellipse((sx - 10, 148 + dy, sx + 10, 176 + dy), fill=COL["KIM_D"], outline=COL["OUT"], width=2)
        if frame == "type_0":
            d.ellipse((100, 166 + dy, 114, 180 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            d.ellipse((142, 154 + dy, 156, 168 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            draw_star(d, 107, 186 + dy, 6, 6, bright=True)
        else:
            d.ellipse((100, 154 + dy, 114, 168 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            d.ellipse((142, 166 + dy, 156, 180 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
            draw_star(d, 149, 186 + dy, 6, 6, bright=True)
    elif frame.startswith("oops"):
        for sx in (94, 162):
            d.ellipse((sx - 11, 140 + dy, sx + 11, 168 + dy), fill=COL["KIM_D"], outline=COL["OUT"], width=2)
            d.arc((sx - 9, 141 + dy, sx + 9, 152 + dy), 180, 360, fill=COL["FRIL"], width=3)
            d.ellipse((sx - 6, 128 + dy, sx + 6, 140 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
    else:
        swing = 6 if frame == "walk_0" else (-6 if frame == "walk_1" else 0)
        l_slv = catmull_rom([(108, 150 + dy), (92 + swing, 160 + dy), (85 + swing, 187 + dy), (108 + swing // 2, 187 + dy)], steps=4)
        r_slv = catmull_rom([(148, 150 + dy), (164 - swing, 160 + dy), (171 - swing, 187 + dy), (148 - swing // 2, 187 + dy)], steps=4)
        draw_closed(d, l_slv, COL["KIM_D"], COL["OUT"], 2)
        draw_closed(d, r_slv, COL["KIM_D"], COL["OUT"], 2)
        d.line([(86 + swing, 183 + dy), (107 + swing // 2, 183 + dy)], fill=COL["FRIL"], width=4)
        d.line([(149 - swing // 2, 183 + dy), (170 - swing, 183 + dy)], fill=COL["FRIL"], width=4)
        # Signature dangling dark kimono ribbons + star charms from 1.webp
        d.line([(86 + swing, 187 + dy), (76 + swing, 206 + dy)], fill=COL["OUT"], width=2)
        draw_star(d, 74 + swing, 209 + dy, 5, 6, bright=False)
        d.line([(170 - swing, 187 + dy), (180 - swing, 206 + dy)], fill=COL["OUT"], width=2)
        draw_star(d, 182 - swing, 209 + dy, 5, 6, bright=False)
        d.ellipse((91 + swing, 187 + dy, 102 + swing, 198 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)
        d.ellipse((154 - swing, 187 + dy, 165 - swing, 198 + dy), fill=COL["SKIN"], outline=COL["OUT"], width=2)


def draw_head_face_and_front_hair(canvas: Image.Image, frame: str, dy: int) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")

    # 1. Luminous anime chibi face with soft mochi cheeks and gentle jawline (width=2 delicate lineart)
    face_pts = catmull_rom(
        [
            (128, 64 + dy), (164, 70 + dy), (177, 94 + dy), (179, 114 + dy),
            (168, 130 + dy), (146, 138 + dy), (128, 140 + dy), (110, 138 + dy),
            (88, 130 + dy), (77, 114 + dy), (79, 94 + dy), (92, 70 + dy),
        ],
        steps=7,
    )
    draw_closed(d, face_pts, COL["SKIN"], COL["OUT"], 2)

    # 2. Rosy blush & authentic 1.webp glossy heterochromia anime eyes
    blush_r = 9 if frame.startswith(("happy", "sleep", "oops", "type")) else 7
    d.ellipse((81, 118 + dy, 81 + blush_r * 2, 126 + dy), fill=COL["BLUSH"])
    d.ellipse((175 - blush_r * 2, 118 + dy, 175, 126 + dy), fill=COL["BLUSH"])

    eye_mode = "open"
    if frame.startswith("happy"):
        eye_mode = "happy"
    elif frame.startswith("sleep") or frame == "idle_1":
        eye_mode = "sleep"
    elif frame.startswith("oops"):
        eye_mode = "oops"
    elif frame.startswith("read"):
        eye_mode = "read"

    left_stops = [(0.0, (112, 18, 58)), (0.45, (255, 52, 128)), (1.0, (255, 176, 212))]
    right_stops = [(0.0, (134, 74, 0)), (0.45, (255, 178, 38)), (1.0, (255, 236, 140))]
    draw_anime_eye(canvas, 103, 108 + dy, left_stops, eye_mode)
    draw_anime_eye(canvas, 153, 108 + dy, right_stops, eye_mode)

    # 3. Delicate anime mouth
    d = ImageDraw.Draw(canvas, "RGBA")
    my = 127 + dy
    if frame.startswith(("happy", "code", "type")):
        d.polygon([(122, my), (128, my + 7), (134, my)], fill=COL["HEART"], outline=COL["OUT"], width=1)
    elif frame.startswith("oops"):
        d.ellipse((124, my - 1, 132, my + 6), fill=(154, 34, 78, 255), outline=COL["OUT"], width=1)
    elif frame.startswith("sleep"):
        d.arc((124, my - 1, 132, my + 4), 10, 170, fill=COL["MOUTH"], width=2)
    else:
        d.arc((120, my - 2, 128, my + 3), 10, 170, fill=COL["MOUTH"], width=2)
        d.arc((128, my - 2, 136, my + 3), 10, 170, fill=COL["MOUTH"], width=2)

    # 4. Spherical crown + seamless wispy anime bangs + cheek-hugging side locks
    hair_mask = Image.new("L", canvas.size, 0)
    hd = ImageDraw.Draw(hair_mask)
    dome_pts = catmull_rom(
        [(70, 96 + dy), (74, 62 + dy), (98, 44 + dy), (128, 39 + dy), (158, 44 + dy), (182, 62 + dy), (186, 96 + dy), (168, 76 + dy), (128, 70 + dy), (88, 76 + dy)],
        steps=6,
    )
    hd.polygon(dome_pts, fill=255)

    bang_tips = [
        [(82, 68 + dy), (85, 96 + dy), (94, 88 + dy), (98, 68 + dy)],
        [(98, 68 + dy), (105, 89 + dy), (114, 95 + dy), (117, 68 + dy)],
        [(117, 68 + dy), (122, 89 + dy), (128, 97 + dy), (134, 89 + dy), (138, 68 + dy)],
        [(138, 68 + dy), (142, 95 + dy), (150, 89 + dy), (156, 68 + dy)],
        [(156, 68 + dy), (162, 88 + dy), (171, 96 + dy), (174, 68 + dy)],
    ]
    side_l = catmull_rom([(70, 74 + dy), (82, 82 + dy), (82, 120 + dy), (92, 140 + dy), (76, 138 + dy), (66, 114 + dy)], steps=5)
    side_r = catmull_rom([(186, 74 + dy), (174, 82 + dy), (174, 120 + dy), (164, 140 + dy), (180, 138 + dy), (190, 114 + dy)], steps=5)
    ahoge = catmull_rom([(125, 41 + dy), (124, 24 + dy), (137, 15 + dy), (148, 17 + dy), (135, 23 + dy), (131, 41 + dy)], steps=5)

    for bpts in bang_tips:
        hd.polygon([(bpts[0][0], 54 + dy)] + bpts + [(bpts[-1][0], 54 + dy)], fill=255)
    for poly in (side_l, side_r, ahoge):
        hd.polygon(poly, fill=255)

    hair_rgba = paint_gradient_mask(hair_mask, 16 + dy, 145 + dy, HAIR_STOPS)
    canvas.alpha_composite(hair_rgba)

    d = ImageDraw.Draw(canvas, "RGBA")
    # Silky anime highlight arcs across dome
    for hx0, hx1, hy in ((88, 114, 55 + dy), (120, 136, 53 + dy), (142, 168, 55 + dy)):
        d.line([(hx0, hy + 4), ((hx0 + hx1) / 2, hy), (hx1, hy + 4)], fill=COL["H_HI"], width=4, joint="curve")

    outer_dome_arc = catmull_rom(
        [(70, 96 + dy), (74, 62 + dy), (98, 44 + dy), (128, 39 + dy), (158, 44 + dy), (182, 62 + dy), (186, 96 + dy)],
        closed=False,
        steps=6,
    )
    d.line(outer_dome_arc, fill=COL["OUT"], width=2, joint="curve")
    for bpts in bang_tips:
        d.line(bpts, fill=COL["OUT"], width=2, joint="curve")
    for poly in (side_l, side_r, ahoge):
        d.line(poly + [poly[0]], fill=COL["OUT"], width=2, joint="curve")

    # 5. Seamless plush cat ears & elongated Gemini star hairpin
    draw_cat_ears(canvas, frame, dy)
    d = ImageDraw.Draw(canvas, "RGBA")
    bright_pin = frame.startswith(("happy", "code", "term"))
    draw_star(d, 174, 70 + dy, 13, 18, bright=bright_pin)
    draw_star(d, 174, 96 + dy, 5, 6, bright=bright_pin)


def draw_integrated_fx(canvas: Image.Image, frame: str, dy: int) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    if frame == "happy_0":
        draw_heart(d, 40, 84, 9)
        draw_star(d, 214, 58, 7, 8, bright=True)
    elif frame == "happy_1":
        draw_heart(d, 38, 60, 10)
        draw_heart(d, 216, 86, 8)
        draw_star(d, 54, 34, 7, 8, bright=True)
        draw_star(d, 206, 38, 8, 9, bright=True)
    elif frame == "code_0":
        draw_star(d, 38, 92, 11, 13, bright=True)
        d.ellipse((222, 66, 230, 74), fill=COL["STAR_C"], outline=COL["OUT"], width=2)
    elif frame == "code_1":
        draw_star(d, 40, 62, 12, 14, bright=True)
        draw_star(d, 220, 146, 10, 12, bright=False)
        d.ellipse((224, 52, 232, 60), fill=COL["STAR_G"], outline=COL["OUT"], width=2)
    elif frame == "term_0":
        d.arc((192, 50 + dy, 212, 86 + dy), -60, 60, fill=COL["STAR_C"], width=4)
        d.arc((202, 44 + dy, 226, 92 + dy), -50, 50, fill=COL["STAR_V"], width=3)
    elif frame == "term_1":
        d.arc((194, 48 + dy, 216, 88 + dy), -65, 65, fill=COL["STAR_G"], width=4)
        d.arc((206, 40 + dy, 232, 96 + dy), -55, 55, fill=COL["STAR_C"], width=4)
    elif frame == "read_0":
        d.ellipse((121, 140 + dy, 135, 154 + dy), fill=COL["STAR_C"], outline=COL["OUT"], width=2)
    elif frame == "read_1":
        draw_star(d, 128, 140 + dy, 8, 9, bright=True)
        d.ellipse((108, 146 + dy, 116, 154 + dy), fill=COL["STAR_V"])
        d.ellipse((142, 144 + dy, 150, 152 + dy), fill=COL["STAR_G"])
    elif frame == "sleep_0":
        d.line([(194, 46), (210, 46), (194, 62), (210, 62)], fill=COL["ZZZ"], width=4, joint="curve")
    elif frame == "sleep_1":
        d.line([(200, 26), (222, 26), (200, 48), (222, 48)], fill=COL["ZZZ"], width=5, joint="curve")
    elif frame == "oops_0":
        d.polygon([(194, 92 + dy), (200, 108 + dy), (188, 108 + dy)], fill=COL["TEAR"], outline=COL["OUT"], width=2)
        draw_star(d, 64, 34, 7, 8, bright=True)
    elif frame == "oops_1":
        d.polygon([(198, 98 + dy), (204, 114 + dy), (192, 114 + dy)], fill=COL["TEAR"], outline=COL["OUT"], width=2)
        draw_star(d, 102, 16, 6, 7, bright=True)
        draw_star(d, 156, 16, 6, 7, bright=True)
    elif frame == "walk_0":
        draw_star(d, 212, 180, 6, 7, bright=True)


def render_frame(frame: str) -> Image.Image:
    canvas = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    if frame in ("happy_1", "walk_0", "oops_1"):
        dy = -5
    elif frame == "sleep_0":
        dy = 10
    elif frame == "sleep_1":
        dy = 14
    else:
        dy = 0

    draw_tapered_tail(canvas, frame, dy)
    draw_back_hair_and_buns(canvas, dy)
    draw_body_and_outfit(canvas, frame, dy)
    draw_head_face_and_front_hair(canvas, frame, dy)
    draw_integrated_fx(canvas, frame, dy)
    return canvas


def rle_sixel_run(chars: list[str]) -> str:
    end = len(chars)
    while end > 0 and chars[end - 1] == "?":
        end -= 1
    if end == 0:
        return ""
    out: list[str] = []
    i = 0
    while i < end:
        ch = chars[i]
        j = i + 1
        while j < end and chars[j] == ch:
            j += 1
        run = j - i
        out.append(f"!{run}{ch}" if run >= 4 else ch * run)
        i = j
    return "".join(out)


def encode_image_to_sixel(
    img_rgba: Image.Image, target_size: int = SIXEL_SIZE, max_colors: int = MAX_SIXEL_COLORS, nearest: bool = False
) -> str:
    resample = Image.Resampling.NEAREST if nearest else Image.Resampling.LANCZOS
    small = img_rgba.resize((target_size, target_size), resample).convert("RGBA")
    w, h = small.size
    spx = small.load()

    opaque_coords: list[tuple[int, int]] = []
    for y in range(h):
        for x in range(w):
            if spx[x, y][3] >= 120:
                opaque_coords.append((x, y))

    if not opaque_coords:
        return f'\x1bP0;1;0q"1;1;{w};{h}\x1b\\'

    strip = Image.new("RGB", (len(opaque_coords), 1))
    opx = strip.load()
    for i, (x, y) in enumerate(opaque_coords):
        r, g, b, _ = spx[x, y]
        opx[i, 0] = (r, g, b)

    quantized = strip.quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT)
    raw_palette = quantized.getpalette() or []
    qpx = quantized.load()

    grid = [[-1] * w for _ in range(h)]
    used_indices: set[int] = set()
    for i, (x, y) in enumerate(opaque_coords):
        idx = int(qpx[i, 0])
        grid[y][x] = idx
        used_indices.add(idx)

    remap = {old: new for new, old in enumerate(sorted(used_indices))}
    palette_rgb = [
        (raw_palette[old * 3], raw_palette[old * 3 + 1], raw_palette[old * 3 + 2])
        for old in sorted(used_indices)
    ]
    for y in range(h):
        for x in range(w):
            if grid[y][x] >= 0:
                grid[y][x] = remap[grid[y][x]]

    parts: list[str] = [f'\x1bP0;1;0q"1;1;{w};{h}']
    for idx, (r, g, b) in enumerate(palette_rgb):
        parts.append(f"#{idx};2;{round(r * 100 / 255)};{round(g * 100 / 255)};{round(b * 100 / 255)}")

    for band_y in range(0, h, 6):
        bh = min(6, h - band_y)
        band_colors: set[int] = set()
        for dy in range(bh):
            row = grid[band_y + dy]
            for x in range(w):
                ci = row[x]
                if ci >= 0:
                    band_colors.add(ci)

        if not band_colors:
            parts.append("-")
            continue

        for ci_pos, ci in enumerate(sorted(band_colors)):
            chars: list[str] = []
            for x in range(w):
                mask = 0
                for dy in range(bh):
                    if grid[band_y + dy][x] == ci:
                        mask |= 1 << dy
                chars.append(chr(63 + mask))
            encoded = rle_sixel_run(chars)
            if encoded:
                if ci_pos > 0:
                    parts.append("$")
                parts.append(f"#{ci}{encoded}")
        parts.append("-")

    parts.append("\x1b\\")
    return "".join(parts)


# -------------------- 12-Color Pure-Code Helper Kittens --------------------

HELPER_PALETTE = [
    "#ff5f87",
    "#ffd75f",
    "#87d75f",
    "#5fd7af",
    "#5fd7ff",
    "#ff9e64",
    "#ff87d7",
    "#d7ff87",
    "#73daca",
    "#f7768e",
    "#ffffaf",
    "#4ec9b0",
]
KITTEN_LOGICAL = 24
KITTEN_PNG_SIZE = 72
KITTEN_SIXEL_SIZE = 48


class PixelCanvas:
    def __init__(self, size: int) -> None:
        self.size = size
        self.grid: list[list[tuple[int, int, int, int] | None]] = [[None] * size for _ in range(size)]

    def px(self, x: int, y: int, col: tuple[int, int, int, int]) -> None:
        if 0 <= x < self.size and 0 <= y < self.size:
            self.grid[y][x] = col

    def rect(self, x0: int, y0: int, x1: int, y1: int, col: tuple[int, int, int, int]) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, col)

    def hline(self, x0: int, x1: int, y: int, col: tuple[int, int, int, int]) -> None:
        for x in range(x0, x1 + 1):
            self.px(x, y, col)

    def disc(self, cx: float, cy: float, r: float, col: tuple[int, int, int, int]) -> None:
        r2 = r * r
        for y in range(max(0, int(cy - r - 1)), min(self.size, int(cy + r + 2))):
            for x in range(max(0, int(cx - r - 1)), min(self.size, int(cx + r + 2))):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                    self.grid[y][x] = col

    def add_outline(self, outline_col: tuple[int, int, int, int]) -> None:
        to_outline: list[tuple[int, int]] = []
        for y in range(self.size):
            for x in range(self.size):
                if self.grid[y][x] is not None:
                    continue
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < self.size and 0 <= ny < self.size:
                        nbr = self.grid[ny][nx]
                        if nbr is not None and nbr != outline_col:
                            to_outline.append((x, y))
                            break
        for x, y in to_outline:
            self.grid[y][x] = outline_col

    def to_image(self) -> Image.Image:
        img = Image.new("RGBA", (self.size, self.size), (0, 0, 0, 0))
        pix = img.load()
        for y in range(self.size):
            for x in range(self.size):
                val = self.grid[y][x]
                if val is not None:
                    pix[x, y] = val
        return img


def hex_to_rgba(h: str) -> tuple[int, int, int, int]:
    s = h.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


def mix_color(c: tuple[int, int, int, int], target: tuple[int, int, int], t: float) -> tuple[int, int, int, int]:
    return (
        round(c[0] + (target[0] - c[0]) * t),
        round(c[1] + (target[1] - c[1]) * t),
        round(c[2] + (target[2] - c[2]) * t),
        255,
    )


def render_kitten(hex_color: str, is_workflow: bool, blink: bool) -> Image.Image:
    base = hex_to_rgba(hex_color)
    hi = mix_color(base, (255, 255, 255), 0.38)
    sh = mix_color(base, (34, 24, 70), 0.28)
    cream = (255, 248, 252, 255)
    pink = (255, 162, 204, 255)
    hat_c = (157, 78, 221, 255)
    hat_s = (114, 46, 176, 255)

    cv = PixelCanvas(KITTEN_LOGICAL)
    hat_shift = 2 if is_workflow else 0

    for tx, ty, tr, tcol in (
        (16, 19, 1.5, sh),
        (18, 19, 1.5, base),
        (20, 17, 1.6, base),
        (20, 14, 1.5, hi),
        (19, 12, 1.2, cream),
    ):
        cv.disc(tx, ty, tr, tcol)

    cv.disc(11.5, 17.5, 4.3, base)
    cv.rect(8, 17, 15, 20, base)
    cv.rect(10, 16, 13, 19, cream)
    cv.hline(9, 10, 21, cream)
    cv.hline(13, 14, 21, cream)

    cv.disc(11.5, 11.2, 4.8, base)
    cv.hline(9, 14, 8, hi)
    cv.px(6, 4 + hat_shift, sh)
    cv.hline(6, 7, 5 + hat_shift, base)
    cv.hline(6, 8, 6 + hat_shift, base)
    cv.hline(6, 9, 7 + hat_shift, base)
    cv.px(7, 6 + hat_shift, pink)
    cv.hline(7, 8, 7 + hat_shift, pink)

    cv.px(17, 4 + hat_shift, sh)
    cv.hline(16, 17, 5 + hat_shift, base)
    cv.hline(15, 17, 6 + hat_shift, base)
    cv.hline(14, 17, 7 + hat_shift, base)
    cv.px(16, 6 + hat_shift, pink)
    cv.hline(15, 16, 7 + hat_shift, pink)

    if is_workflow:
        cv.hline(9, 14, 6, hat_s)
        cv.rect(9, 3, 14, 5, hat_c)
        cv.hline(10, 13, 2, hat_c)
        cv.hline(11, 12, 1, hat_s)
        cv.px(11, 4, COL["STAR_G"])
        cv.px(12, 4, COL["STAR_G"])

    if blink:
        cv.hline(8, 9, 11, COL["OUT"])
        cv.hline(14, 15, 11, COL["OUT"])
    else:
        cv.rect(8, 10, 9, 11, COL["OUT"])
        cv.px(8, 10, COL["WHT"])
        cv.rect(14, 10, 15, 11, COL["OUT"])
        cv.px(14, 10, COL["WHT"])
    cv.hline(10, 13, 13, cream)
    cv.hline(11, 12, 12, pink)
    cv.px(10, 13, COL["MOUTH"])
    cv.px(13, 13, COL["MOUTH"])
    cv.px(7, 12, pink)
    cv.px(16, 12, pink)

    cv.add_outline(COL["OUT"])
    return cv.to_image()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    kittens_dir = OUT_DIR / "kittens"
    kittens_dir.mkdir(parents=True, exist_ok=True)
    for old in list(OUT_DIR.glob("*.png")) + list(OUT_DIR.glob("*.sixel")):
        old.unlink()
    for old in list(kittens_dir.glob("*.png")) + list(kittens_dir.glob("*.sixel")):
        old.unlink()

    cols = 6
    rows = 3
    contact = Image.new("RGBA", (PNG_SIZE * cols, PNG_SIZE * rows), (26, 27, 38, 255))
    draw = ImageDraw.Draw(contact)
    manifest_poses: list[dict[str, str]] = []

    for idx, frame in enumerate(FRAMES):
        master = render_frame(frame)
        right_img = master.resize((PNG_SIZE, PNG_SIZE), Image.Resampling.LANCZOS)
        left_img = right_img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

        right_png = f"{frame}_r.png"
        left_png = f"{frame}_l.png"
        right_sixel = f"{frame}_r.sixel"
        left_sixel = f"{frame}_l.sixel"

        right_img.save(OUT_DIR / right_png, "PNG")
        left_img.save(OUT_DIR / left_png, "PNG")
        (OUT_DIR / right_sixel).write_text(encode_image_to_sixel(master, SIXEL_SIZE), encoding="ascii")
        (OUT_DIR / left_sixel).write_text(
            encode_image_to_sixel(master.transpose(Image.Transpose.FLIP_LEFT_RIGHT), SIXEL_SIZE),
            encoding="ascii",
        )

        cx = (idx % cols) * PNG_SIZE
        cy = (idx // cols) * PNG_SIZE
        contact.alpha_composite(right_img, (cx, cy))
        draw.text((cx + 4, cy + 4), frame, fill=(169, 177, 214, 255))

        manifest_poses.append(
            {
                "pose": frame,
                "rightPng": right_png,
                "leftPng": left_png,
                "rightSixel": right_sixel,
                "leftSixel": left_sixel,
            }
        )

    contact.save(OUT_DIR / "contact_sheet.png", "PNG")

    kittens_sheet = Image.new(
        "RGBA", (KITTEN_PNG_SIZE * len(HELPER_PALETTE), KITTEN_PNG_SIZE * 2), (26, 27, 38, 255)
    )
    k_draw = ImageDraw.Draw(kittens_sheet)
    manifest_kittens: list[dict[str, str]] = []

    for idx, hex_color in enumerate(HELPER_PALETTE):
        entry: dict[str, str] = {"color": hex_color}
        for wf_key, is_wf in (("plain", False), ("wf", True)):
            for eye_key, is_blink in (("open", False), ("blink", True)):
                base_k = render_kitten(hex_color, is_wf, is_blink)
                k_png_rel = f"kittens/kitten_{idx:02d}_{wf_key}_{eye_key}.png"
                k_six_rel = f"kittens/kitten_{idx:02d}_{wf_key}_{eye_key}.sixel"
                k_img = base_k.resize((KITTEN_PNG_SIZE, KITTEN_PNG_SIZE), Image.Resampling.NEAREST)
                k_img.save(OUT_DIR / k_png_rel, "PNG")
                (OUT_DIR / k_six_rel).write_text(
                    encode_image_to_sixel(base_k, KITTEN_SIXEL_SIZE, nearest=True), encoding="ascii"
                )
                field_prefix = f"{wf_key}{'Blink' if is_blink else 'Open'}"
                entry[f"{field_prefix}Png"] = k_png_rel
                entry[f"{field_prefix}Sixel"] = k_six_rel
                if not is_blink:
                    kx = idx * KITTEN_PNG_SIZE
                    ky = (1 if is_wf else 0) * KITTEN_PNG_SIZE
                    kittens_sheet.alpha_composite(k_img, (kx, ky))
                    k_draw.text((kx + 2, ky + 2), f"{idx}{'w' if is_wf else ''}", fill=(169, 177, 214, 255))
        manifest_kittens.append(entry)

    kittens_sheet.save(OUT_DIR / "kittens_sheet.png", "PNG")

    manifest = {
        "version": 6,
        "masterSize": MASTER_SIZE,
        "pngSize": PNG_SIZE,
        "sixelSize": SIXEL_SIZE,
        "kittenPngSize": KITTEN_PNG_SIZE,
        "kittenSixelSize": KITTEN_SIXEL_SIZE,
        "poses": manifest_poses,
        "kittens": manifest_kittens,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        f"Built {len(FRAMES) * 2} 1.webp-styled 256->128/96 catgirl frames and "
        f"{len(HELPER_PALETTE) * 4} helper kittens in {OUT_DIR}"
    )


if __name__ == "__main__":
    main()
