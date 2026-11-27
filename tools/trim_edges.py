#!/usr/bin/python3
"""絵に描きこまれた「紙のふち」（明るくて色の薄い帯）の幅を測り、book.json と manifest.json に書く。

本ごと・ページごとに ふちの幅が違うので、そのままだと 本棚の表紙や よむ画面の絵の大きさが
ばらばらに見える。アプリはこの値（trim）のぶんだけ絵を拡大して、ふちを切り落とす。

  trim … 上下左右それぞれ、幅（高さ）の何割を切り落とすか（0〜0.08）
  w, h … 絵の大きさ（読み込む前から 絵の枠の形を決めるため）

使い方（Mac 標準の python3。PIL が入っている）:
    /usr/bin/python3 tools/trim_edges.py            # 全冊
    /usr/bin/python3 tools/trim_edges.py gemini     # 1冊だけ
    /usr/bin/python3 tools/trim_edges.py --check    # 測るだけ（書きこまない）

import_book.py で本を取り込んだときは、自動でこれも動く。
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = ROOT / "books"

MAX_TRIM = 0.08      # これより太い「ふち」は、ふちではなく明るい空などとみなす
MARGIN = 0.006       # ふちの にじみが少し残らないように、すこし多めに切る


def side_widths(path):
    """上・下・左・右の ふちの幅を、それぞれの辺の長さに対する割合で返す。"""
    img = Image.open(path).convert("RGB")
    w, h = img.size
    small = img.resize((400, max(1, round(400 * h / w))))
    a = np.asarray(small).astype(int)
    mx, mn = a.max(axis=2), a.min(axis=2)
    paper = (mx > 205) & (mx - mn < 45)          # 白っぽくて色の薄いところ

    def run(lines):
        n = 0
        for frac in lines:
            if frac < 0.5:
                break
            n += 1
        return n

    H, W = paper.shape
    rows, cols = paper.mean(axis=1), paper.mean(axis=0)
    t, b = run(rows) / H, run(rows[::-1]) / H
    l, r = run(cols) / W, run(cols[::-1]) / W
    return [min(x, MAX_TRIM) for x in (t, b, l, r)], (w, h)


def measure(path):
    """切り落とす割合（上下左右おなじ）と、絵の大きさを返す。
    紙のふちは まわり全体にあるので、2番目に太い辺の値を使う。
    （明るい空が1辺だけ「ふち」に見えても、それには引っぱられない）"""
    sides, size = side_widths(path)
    second = sorted(sides)[-2]
    trim = round(second + MARGIN, 3) if second >= 0.004 else 0
    return min(trim, MAX_TRIM), size


def apply_to_book(book_dir, write=True):
    bj = book_dir / "book.json"
    book = json.loads(bj.read_text(encoding="utf-8"))
    for p in book["pages"]:
        trim, (w, h) = measure(book_dir / p["image"])
        p["trim"], p["w"], p["h"] = trim, w, h
    cover_trim, _ = measure(book_dir / book["cover"])
    book["coverTrim"] = cover_trim
    print(f"  {book['slug']:<14} 表紙 {cover_trim:.3f}  ページ " +
          " ".join(f"{p['trim']:.3f}" for p in book["pages"]))
    if write:
        bj.write_text(json.dumps(book, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--check" not in sys.argv
    dirs = [BOOKS_DIR / s for s in args] if args else sorted(d for d in BOOKS_DIR.iterdir() if (d / "book.json").exists())
    for d in dirs:
        apply_to_book(d, write)
    if write:
        sys.path.insert(0, str(Path(__file__).parent))
        from import_book import update_manifest
        update_manifest()
        print("manifest.json を更新しました")


if __name__ == "__main__":
    main()
