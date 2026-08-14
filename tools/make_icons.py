#!/usr/bin/env python3
"""ホーム画面に置くアイコン（星）を作る。

使い方:
    python3 tools/make_icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
SIZES = [180, 192, 512]

NAVY_TOP = (14, 26, 60)
NAVY_BOTTOM = (43, 63, 112)
GOLD = (255, 214, 120)
GOLD_CORE = (255, 245, 214)


def star_points(cx, cy, outer, inner, n=5):
    pts = []
    for i in range(n * 2):
        r = outer if i % 2 == 0 else inner
        a = -math.pi / 2 + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def make(size):
    s = size * 4  # 4倍で描いてから縮小し、ふちをなめらかにする
    img = Image.new("RGB", (s, s), NAVY_TOP)
    d = ImageDraw.Draw(img)

    # 夜空のグラデーション
    for y in range(s):
        t = y / (s - 1)
        d.line([(0, y), (s, y)], fill=tuple(
            round(NAVY_TOP[i] + (NAVY_BOTTOM[i] - NAVY_TOP[i]) * t) for i in range(3)))

    # 小さな星をちりばめる
    small = [(.16, .18, 3), (.82, .14, 2.4), (.28, .74, 2.6), (.74, .8, 3),
             (.5, .12, 2), (.12, .5, 2.2), (.88, .52, 2.4), (.62, .88, 2)]
    for fx, fy, r in small:
        rr = r * s / 260
        d.ellipse([fx * s - rr, fy * s - rr, fx * s + rr, fy * s + rr],
                  fill=(255, 255, 255))

    # まんなかの大きな星（うっすら光らせる）
    glow = Image.new("RGB", (s, s), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.polygon(star_points(s / 2, s / 2 * 1.02, s * .34, s * .145), fill=GOLD)
    glow = glow.filter(ImageFilter.GaussianBlur(s * .05))
    img = Image.blend(img, Image.blend(img, glow, .0), 0)
    img = Image.composite(
        Image.blend(img, glow, .85), img,
        glow.convert("L").point(lambda v: min(255, v * 3)))

    d = ImageDraw.Draw(img)
    d.polygon(star_points(s / 2, s / 2 * 1.02, s * .34, s * .145), fill=GOLD)
    d.polygon(star_points(s / 2, s / 2 * 1.02, s * .20, s * .085), fill=GOLD_CORE)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    for size in SIZES:
        p = OUT / f"icon-{size}.png"
        make(size).save(p, "PNG")
        print(f"作成: assets/{p.name}  ({p.stat().st_size / 1024:.0f}KB)")


if __name__ == "__main__":
    main()
