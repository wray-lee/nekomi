"""Import the 3 high-craft SD chibi anime sprite sheets into 18 PNG + P2=1 Sixel frames for nekomi."""

from __future__ import annotations

from collections import deque
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "sprites"

SHEET_1 = Path(r"C:\Users\Wray\.gemini\antigravity-cli\brain\87bab6bf-f444-4be8-96c3-3f1490f1a99f\nekomi_proto_raw_v2_1795683409282.jpg")
SHEET_2 = Path(r"C:\Users\Wray\.gemini\antigravity-cli\brain\87bab6bf-f444-4be8-96c3-3f1490f1a99f\nekomi_sheet2_final_1795683971116.jpg")
SHEET_3 = Path(r"C:\Users\Wray\.gemini\antigravity-cli\brain\87bab6bf-f444-4be8-96c3-3f1490f1a99f\nekomi_sheet3_raw_1795683907843.jpg")

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

PNG_SIZE = 128
SIXEL_SIZE = 84
MAX_SIXEL_COLORS = 64


def sample_corner_bg(img: Image.Image) -> tuple[int, int, int]:
    px = img.load()
    w, h = img.size
    samples = [px[4, 4], px[w - 5, 4], px[4, h - 5], px[w - 5, h - 5]]
    return (
        sum(c[0] for c in samples) // len(samples),
        sum(c[1] for c in samples) // len(samples),
        sum(c[2] for c in samples) // len(samples),
    )


def find_split_axes(img: Image.Image, bg: tuple[int, int, int]) -> tuple[int, int]:
    w, h = img.size
    px = img.load()
    br, bg_g, bb = bg

    best_x, best_x_err = w // 2, float("inf")
    for x in range(int(w * 0.42), int(w * 0.58)):
        err = sum(abs(px[x, y][0] - br) + abs(px[x, y][1] - bg_g) + abs(px[x, y][2] - bb) for y in range(0, h, 4))
        if err < best_x_err:
            best_x_err = err
            best_x = x

    best_y, best_y_err = h // 2, float("inf")
    for y in range(int(h * 0.42), int(h * 0.58)):
        err = sum(abs(px[x, y][0] - br) + abs(px[x, y][1] - bg_g) + abs(px[x, y][2] - bb) for x in range(0, w, 4))
        if err < best_y_err:
            best_y_err = err
            best_y = y

    return best_x, best_y


def is_chroma_bg(r: int, g: int, b: int, bg: tuple[int, int, int]) -> bool:
    br, bg_g, bb = bg
    green_excess = g - max(r, b)
    dist = ((r - br) ** 2 + (g - bg_g) ** 2 + (b - bb) ** 2) ** 0.5
    return (green_excess > 35 and dist < 180) or (green_excess > 60 and g > 120)


def key_and_clean(quad: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    rgba = quad.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_chroma_bg(*px[x, y][:3], bg):
                visited[y][x] = True
                q.append((x, y))
    for y in range(1, h - 1):
        for x in (0, w - 1):
            if is_chroma_bg(*px[x, y][:3], bg):
                visited[y][x] = True
                q.append((x, y))

    # Clear enclosed green gaps between hair strands
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if not visited[y][x]:
                r, g, b, _ = px[x, y]
                if (g - max(r, b)) > 48 and g > 110:
                    visited[y][x] = True
                    q.append((x, y))

    while q:
        cx, cy = q.popleft()
        px[cx, cy] = (0, 0, 0, 0)
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                if is_chroma_bg(*px[nx, ny][:3], bg):
                    visited[ny][nx] = True
                    q.append((nx, ny))

    # Two-pass edge green despill and halo trim
    alpha_mask = [[px[x, y][3] for x in range(w)] for y in range(h)]
    for pass_idx in range(2):
        updates: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                adj_trans = any(
                    0 <= nx < w and 0 <= ny < h and alpha_mask[ny][nx] == 0
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                )
                if not adj_trans:
                    continue
                green_excess = g - max(r, b)
                if green_excess > 14 or (pass_idx == 0 and green_excess > 8 and g > 95):
                    if green_excess > 30 and (r + b) < 230:
                        updates.append((x, y, (0, 0, 0, 0)))
                    else:
                        new_g = min(g, max(r, b, (r + b) // 2 + 2))
                        new_a = max(0, min(255, int(a * max(0.25, 1.0 - max(0, green_excess) / 60.0))))
                        updates.append((x, y, (r, new_g, b, new_a)))
                elif pass_idx == 0 and g > max(r, b):
                    updates.append((x, y, (r, min(g, (r + b) // 2 + 4), b, a)))
        for x, y, val in updates:
            px[x, y] = val
            alpha_mask[y][x] = val[3]

    # Prune tiny <6px JPEG compression specks
    comp_seen = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0 or comp_seen[y][x]:
                continue
            comp: list[tuple[int, int]] = []
            dq = deque([(x, y)])
            comp_seen[y][x] = True
            while dq:
                cx, cy = dq.popleft()
                comp.append((cx, cy))
                for nx in range(max(0, cx - 1), min(w, cx + 2)):
                    for ny in range(max(0, cy - 1), min(h, cy + 2)):
                        if not comp_seen[ny][nx] and px[nx, ny][3] > 0:
                            comp_seen[ny][nx] = True
                            dq.append((nx, ny))
            if len(comp) < 6:
                for cx, cy in comp:
                    px[cx, cy] = (0, 0, 0, 0)

    return rgba


def fit_to_master(
    rgba: Image.Image,
    target_size: int = 256,
    max_w: int = 236,
    max_h: int = 236,
    bottom_pad: int = 8,
    dx_shift: int = 0,
    dy_shift: int = 0,
    preferred_scale: float | None = None,
) -> tuple[Image.Image, float]:
    bbox = rgba.getbbox()
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    if not bbox:
        return canvas, 1.0
    cropped = rgba.crop(bbox)
    cw, ch = cropped.size
    fit_scale = min(max_w / cw, max_h / ch)
    scale = min(fit_scale, preferred_scale) if preferred_scale is not None else fit_scale
    nw = max(1, round(cw * scale))
    nh = max(1, round(ch * scale))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    ox = max(0, min(target_size - nw, (target_size - nw) // 2 + dx_shift))
    oy = max(0, min(target_size - nh, target_size - bottom_pad - nh + dy_shift))
    canvas.paste(resized, (ox, oy), resized)
    return canvas, scale


def stretch_feet_anchored(img: Image.Image, scale_x: float, scale_y: float, dx: int = 0, dy: int = 0) -> Image.Image:
    w, h = img.size
    bbox = img.getbbox()
    if not bbox:
        return img.copy()
    nw = max(1, round(w * scale_x))
    nh = max(1, round(h * scale_y))
    scaled = img.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ox = (w - nw) // 2 + dx
    oy = round((h - 8) - (h - 8) * scale_y) + dy
    canvas.paste(scaled, (ox, oy), scaled)
    return canvas


def draw_four_star(draw: ImageDraw.ImageDraw, cx: int, cy: int, r_outer: int, color: tuple[int, int, int, int]) -> None:
    r_inner = max(2, r_outer // 3)
    pts = [
        (cx, cy - r_outer),
        (cx + r_inner, cy - r_inner),
        (cx + r_outer, cy),
        (cx + r_inner, cy + r_inner),
        (cx, cy + r_outer),
        (cx - r_inner, cy + r_inner),
        (cx - r_outer, cy),
        (cx - r_inner, cy - r_inner),
    ]
    draw.polygon(pts, fill=color)


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


def encode_image_to_sixel(img_rgba: Image.Image, target_size: int = SIXEL_SIZE, max_colors: int = MAX_SIXEL_COLORS) -> str:
    small = img_rgba.resize((target_size, target_size), Image.Resampling.LANCZOS).convert("RGBA")
    r, g, b, a = small.split()
    rgb_sharp = Image.merge("RGB", (r, g, b)).filter(ImageFilter.UnsharpMask(radius=0.8, percent=85, threshold=2))
    small = Image.merge("RGBA", (*rgb_sharp.split(), a))

    w, h = small.size
    spx = small.load()
    opaque_coords = [(x, y) for y in range(h) for x in range(w) if spx[x, y][3] >= 120]
    if not opaque_coords:
        return f'\x1bP0;1;0q"1;1;{w};{h}\x1b\\'

    strip = Image.new("RGB", (len(opaque_coords), 1))
    opx = strip.load()
    for i, (x, y) in enumerate(opaque_coords):
        opx[i, 0] = spx[x, y][:3]

    quantized = strip.quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
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
    for idx, (pr, pg, pb) in enumerate(palette_rgb):
        parts.append(f"#{idx};2;{round(pr * 100 / 255)};{round(pg * 100 / 255)};{round(pb * 100 / 255)}")

    for band_y in range(0, h, 6):
        bh = min(6, h - band_y)
        band_colors = {grid[band_y + dy][x] for dy in range(bh) for x in range(w) if grid[band_y + dy][x] >= 0}
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


def extract_sheet_quads(path: Path) -> dict[str, Image.Image]:
    raw = Image.open(path).convert("RGB")
    w, h = raw.size
    bg = sample_corner_bg(raw)
    sx, sy = find_split_axes(raw, bg)
    quads = {
        "tl": raw.crop((0, 0, sx, sy)),
        "tr": raw.crop((sx, 0, w, sy)),
        "bl": raw.crop((0, sy, sx, h)),
        "br": raw.crop((sx, sy, w, h)),
    }
    return {k: key_and_clean(q, bg) for k, q in quads.items()}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    existing_manifest_path = OUT_DIR / "manifest.json"
    existing_kittens = []
    if existing_manifest_path.exists():
        existing_kittens = json.loads(existing_manifest_path.read_text(encoding="utf-8")).get("kittens", [])

    s1 = extract_sheet_quads(SHEET_1)
    s2 = extract_sheet_quads(SHEET_2)
    s3 = extract_sheet_quads(SHEET_3)

    # Fit standing poses first to establish uniform character proportions across all sheets
    idle_0, idle_scale = fit_to_master(s1["tl"])
    idle_1 = stretch_feet_anchored(idle_0, 1.015, 0.975)

    walk_0, _ = fit_to_master(s2["tl"], preferred_scale=idle_scale * 1.04)
    walk_1, _ = fit_to_master(s2["tr"], preferred_scale=idle_scale * 1.04, dy_shift=-3)

    code_0, _ = fit_to_master(s1["bl"], preferred_scale=idle_scale * 1.04)
    code_1 = stretch_feet_anchored(code_0, 1.0, 1.0, dy=-3)
    d_code = ImageDraw.Draw(code_1)
    draw_four_star(d_code, 224, 92, 10, (165, 245, 255, 255))
    draw_four_star(d_code, 178, 72, 7, (255, 244, 175, 255))

    term_0, _ = fit_to_master(s2["bl"], preferred_scale=idle_scale * 1.04)
    term_1 = stretch_feet_anchored(term_0, 1.01, 0.985, dy=-2)
    d_term = ImageDraw.Draw(term_1)
    draw_four_star(d_term, 228, 128, 8, (165, 245, 255, 255))
    draw_four_star(d_term, 198, 114, 6, (255, 244, 175, 255))

    read_0, _ = fit_to_master(s2["br"], preferred_scale=idle_scale * 1.04)
    read_1 = stretch_feet_anchored(read_0, 1.012, 0.985)
    d_read = ImageDraw.Draw(read_1)
    draw_four_star(d_read, 206, 122, 9, (220, 252, 255, 255))

    happy_0, _ = fit_to_master(s1["tr"], preferred_scale=idle_scale * 1.04)
    happy_1, _ = fit_to_master(s3["bl"], preferred_scale=idle_scale * 1.04, dy_shift=-4)

    # Sleep is curled/sitting, so normalize height to avoid enlarging head relative to standing poses
    sleep_1, _ = fit_to_master(s3["br"], max_w=236, max_h=208, preferred_scale=idle_scale * 1.02)
    sleep_0 = stretch_feet_anchored(sleep_1, 1.014, 0.98)

    oops_0, _ = fit_to_master(s3["tl"], preferred_scale=idle_scale * 1.04)
    oops_1 = stretch_feet_anchored(oops_0, 1.0, 1.0, dx=3, dy=-2)
    d_oops = ImageDraw.Draw(oops_1)
    draw_four_star(d_oops, 226, 78, 9, (255, 242, 145, 255))

    type_0, _ = fit_to_master(s3["tr"], preferred_scale=idle_scale * 1.04)
    type_1 = stretch_feet_anchored(type_0, 1.012, 0.985, dy=-3)
    d_type = ImageDraw.Draw(type_1)
    draw_four_star(d_type, 134, 136, 7, (170, 246, 255, 255))
    draw_four_star(d_type, 176, 132, 7, (170, 246, 255, 255))

    masters: dict[str, Image.Image] = {
        "idle_0": idle_0, "idle_1": idle_1,
        "walk_0": walk_0, "walk_1": walk_1,
        "code_0": code_0, "code_1": code_1,
        "term_0": term_0, "term_1": term_1,
        "read_0": read_0, "read_1": read_1,
        "happy_0": happy_0, "happy_1": happy_1,
        "sleep_0": sleep_0, "sleep_1": sleep_1,
        "oops_0": oops_0, "oops_1": oops_1,
        "type_0": type_0, "type_1": type_1,
    }

    cols, rows = 6, 3
    contact = Image.new("RGBA", (PNG_SIZE * cols, PNG_SIZE * rows), (26, 27, 38, 255))
    draw = ImageDraw.Draw(contact)
    manifest_poses: list[dict[str, str]] = []

    for idx, frame in enumerate(FRAMES):
        master_r = masters[frame]
        master_l = master_r.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

        right_img = master_r.resize((PNG_SIZE, PNG_SIZE), Image.Resampling.LANCZOS)
        left_img = master_l.resize((PNG_SIZE, PNG_SIZE), Image.Resampling.LANCZOS)

        right_png = f"{frame}_r.png"
        left_png = f"{frame}_l.png"
        right_sixel = f"{frame}_r.sixel"
        left_sixel = f"{frame}_l.sixel"

        right_img.save(OUT_DIR / right_png, "PNG")
        left_img.save(OUT_DIR / left_png, "PNG")
        (OUT_DIR / right_sixel).write_text(encode_image_to_sixel(master_r, SIXEL_SIZE), encoding="ascii")
        (OUT_DIR / left_sixel).write_text(encode_image_to_sixel(master_l, SIXEL_SIZE), encoding="ascii")

        cx = (idx % cols) * PNG_SIZE
        cy = (idx // cols) * PNG_SIZE
        contact.alpha_composite(right_img, (cx, cy))
        draw.text((cx + 4, cy + 4), frame, fill=(169, 177, 214, 255))

        manifest_poses.append({
            "pose": frame,
            "rightPng": right_png,
            "leftPng": left_png,
            "rightSixel": right_sixel,
            "leftSixel": left_sixel,
        })

    contact.save(OUT_DIR / "contact_sheet.png", "PNG")

    manifest = {
        "version": 8,
        "masterSize": 256,
        "pngSize": PNG_SIZE,
        "sixelSize": SIXEL_SIZE,
        "kittenPngSize": 72,
        "kittenSixelSize": 42,
        "poses": manifest_poses,
        "kittens": existing_kittens,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Exported {len(FRAMES) * 2} illustrated SD chibi catgirl frames (PNG + Sixel) to {OUT_DIR}")


if __name__ == "__main__":
    main()
