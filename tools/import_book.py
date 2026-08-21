#!/usr/bin/env python3
"""既存の絵本HTML（画像をBase64で埋め込んだ単一ファイル）を、
ほしぞら絵本アプリ用のデータ（book.json + WebP画像）に変換する。

使い方:
    python3 tools/import_book.py "<絵本HTMLのパス>" [--slug orion]

元のHTMLは読むだけで、一切書き換えない。
"""
import argparse
import base64
import io
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = ROOT / "books"
MANIFEST = ROOT / "manifest.json"

# 画像の変換設定：iPadのRetina表示に十分で、かつ軽い
MAX_SIDE = 1200
WEBP_QUALITY = 82

# 星座名 → フォルダ名（英語スラッグ）
SLUG_MAP = {
    "オリオン座": "orion",
    "カシオペア座": "cassiopeia",
    "ふたご座": "gemini",
    "おおぐま座": "ursa-major",
    "おとめ座": "virgo",
    "いて座": "sagittarius",
    "みずがめ座": "aquarius",
}

# 表示順（本棚に並ぶ順番）
BOOK_ORDER = ["orion", "gemini", "ursa-major", "cassiopeia", "virgo", "sagittarius", "aquarius"]

# テーマ色の上書き（ふたご座とおおぐま座が元は同じ紫だったため振り分け直す）
# ※暫定値。Step 2 で実物を見て確定する。
THEME_OVERRIDE = {
    "gemini": "#1a8cb8",      # 双子星の青白い光
    "ursa-major": "#33499b",  # 北の夜空の藍
}


class BookParser(HTMLParser):
    """絵本HTMLから タイトル / サブタイトル / 各ページの画像とテキスト を取り出す。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # (tag, class属性) の入れ子
        self.doc_title = ""
        self.h1_lines = []
        self.subtitle = ""
        self.pages = []          # [{"image": data-uri, "alt": str, "paragraphs": [...]}]
        self._cur_page = None
        self._cur_para = None    # [[token, ...], ...]  行のリスト
        self._cur_line = None    # [token, ...]
        self._in_doc_title = False
        self._ruby = None        # 組み立て中のふりがな
        self._in_rt = False      # いま <rt>（よみ）の中か

    # --- 入れ子の判定ヘルパー -------------------------------------------------
    def _in_class(self, cls):
        return any(cls in (c or "").split() for _, c in self.stack)

    def _in_tag_with_class(self, tag, cls):
        return any(t == tag and cls in (c or "").split() for t, c in self.stack)

    # --- タグ ---------------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "")

        if tag == "title":
            self._in_doc_title = True

        if tag == "img" and "page-image" in cls.split():
            if self._cur_page is not None:
                self._cur_page["image"] = a.get("src", "")
                self._cur_page["alt"] = a.get("alt", "")
            # img は空要素なのでスタックに積まない
            return

        if tag == "br":
            # 改行：いま行を組み立て中なら、そこで行を閉じる
            if self._cur_line is not None:
                self._cur_para.append(self._cur_line)
                self._cur_line = []
            elif self._in_class("title-page") and self._collecting_h1():
                self.h1_lines.append("")
            return

        self.stack.append((tag, cls))

        if tag == "ruby":
            self._ruby = {"base": "", "rt": ""}
        elif tag == "rt":
            self._in_rt = True

        if tag == "div" and "page" in cls.split():
            self._cur_page = {"image": "", "alt": "", "paragraphs": []}

        if tag == "p" and self._in_class("page-text"):
            self._cur_para = []
            self._cur_line = []

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_doc_title = False

        if tag == "rt":
            self._in_rt = False

        if tag == "ruby" and self._ruby is not None:
            r, self._ruby = self._ruby, None
            base, yomi = r["base"].strip(), r["rt"].strip()
            if self._cur_line is not None and base:
                tok = {"t": base, "h": self._in_tag_with_class("span", "highlight")}
                if yomi:
                    tok["r"] = yomi          # ふりがな
                self._cur_line.append(tok)

        if tag == "p" and self._cur_para is not None:
            if self._cur_line:
                self._cur_para.append(self._cur_line)
            lines = [ln for ln in self._cur_para if ln]
            if lines and self._cur_page is not None:
                self._cur_page["paragraphs"].append(lines)
            self._cur_para = None
            self._cur_line = None

        # スタックを、一致する直近のタグまで巻き戻す
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                closing = self.stack[i]
                del self.stack[i:]
                if tag == "div" and "page" in (closing[1] or "").split():
                    if self._cur_page is not None:
                        self.pages.append(self._cur_page)
                        self._cur_page = None
                break

    def _collecting_h1(self):
        return self._in_tag_with_class("h1", "") or any(t == "h1" for t, _ in self.stack)

    # --- テキスト -----------------------------------------------------------
    def handle_data(self, data):
        if self._in_doc_title:
            self.doc_title += data
            return

        # ふりがなを組み立て中なら、そちらへ流す
        if self._ruby is not None:
            self._ruby["rt" if self._in_rt else "base"] += data
            return

        # HTMLソースの改行とインデントだけを取り除く。
        # 語と語のあいだの半角スペースは意味があるので残す。
        if "\n" in data and not data.strip():
            return
        text = re.sub(r"\s*\n\s*", "", data)
        if not text:
            return

        # ページ本文
        if self._cur_line is not None:
            self._cur_line.append({
                "t": text,
                "h": self._in_tag_with_class("span", "highlight"),
            })
            return

        # 表紙のタイトル・サブタイトル
        if self._in_class("title-page"):
            t = text.strip()
            if not t:
                return
            if any(tag == "h1" for tag, _ in self.stack):
                if self.h1_lines and self.h1_lines[-1] == "":
                    self.h1_lines[-1] = t
                else:
                    self.h1_lines.append(t)
            elif self._in_class("subtitle"):
                self.subtitle += t


def data_uri_to_webp(data_uri, out_path):
    """data:image/...;base64,... を WebP に変換して保存し、(元サイズ, 新サイズ) を返す。"""
    m = re.match(r"data:image/[a-zA-Z0-9.+-]+;base64,(.*)", data_uri, re.S)
    if not m:
        raise ValueError("画像がBase64形式ではありません")

    raw = base64.b64decode(m.group(1))
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")

    w, h = img.size
    if max(w, h) > MAX_SIDE:
        scale = MAX_SIDE / max(w, h)
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

    img.save(out_path, "WEBP", quality=WEBP_QUALITY, method=6)
    return len(raw), out_path.stat().st_size, (w, h), img.size


def extract_theme(html):
    m = re.search(r"--highlight:\s*([^;]+);", html)
    return m.group(1).strip() if m else "#7c3aed"


def guess_slug(path):
    for jp, slug in SLUG_MAP.items():
        if jp in path.name:
            return slug, jp
    return None, None


def main():
    ap = argparse.ArgumentParser(description="絵本HTMLをアプリ用データに変換する")
    ap.add_argument("html", help="絵本HTMLのパス")
    ap.add_argument("--slug", help="フォルダ名（省略時はファイル名から推測）")
    args = ap.parse_args()

    src = Path(args.html)
    if not src.exists():
        sys.exit(f"エラー: ファイルが見つかりません → {src}")

    slug, jp_name = guess_slug(src)
    slug = args.slug or slug
    if not slug:
        sys.exit(f"エラー: フォルダ名を推測できません。--slug で指定してください → {src.name}")

    print(f"\n── {jp_name or src.name} → books/{slug}/")
    html = src.read_text(encoding="utf-8")

    parser = BookParser()
    parser.feed(html)

    if not parser.pages:
        sys.exit("エラー: ページが1つも見つかりませんでした")

    out_dir = BOOKS_DIR / slug
    out_dir.mkdir(parents=True, exist_ok=True)

    total_before = total_after = 0
    pages_data = []

    for i, page in enumerate(parser.pages, start=1):
        if not page["image"]:
            print(f"  ! {i}ページ目に画像がありません。スキップします")
            continue
        fname = f"p{i:02d}.webp"
        before, after, size_before, size_after = data_uri_to_webp(
            page["image"], out_dir / fname
        )
        total_before += before
        total_after += after
        print(
            f"  p{i:02d}  {size_before[0]}x{size_before[1]} {before/1024/1024:5.2f}MB"
            f"  →  {size_after[0]}x{size_after[1]} {after/1024:6.1f}KB"
        )
        pages_data.append(
            {
                "image": fname,
                "alt": page["alt"],
                "paragraphs": page["paragraphs"],
                "audio": None,  # 読み上げ音声を後から足すための予約枠
            }
        )

    # 表紙は1ページ目の画像を流用する
    cover = pages_data[0]["image"] if pages_data else None

    theme = THEME_OVERRIDE.get(slug, extract_theme(html))

    title = " ".join(l for l in parser.h1_lines if l).strip() or parser.doc_title.strip()
    book = {
        "slug": slug,
        "title": title,
        "titleLines": [l for l in parser.h1_lines if l],
        "subtitle": parser.subtitle.strip(),
        "theme": theme,
        "cover": cover,
        "pages": pages_data,
        "source": src.name,
    }
    (out_dir / "book.json").write_text(
        json.dumps(book, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(
        f"  ── {len(pages_data)}ページ  "
        f"{total_before/1024/1024:.1f}MB → {total_after/1024/1024:.2f}MB "
        f"（{total_after/total_before*100:.0f}%）"
    )

    update_manifest()
    return total_before, total_after


def update_manifest():
    """books/ 以下を見て manifest.json を作り直す。"""
    entries = []
    for d in sorted(BOOKS_DIR.iterdir()) if BOOKS_DIR.exists() else []:
        bj = d / "book.json"
        if not bj.exists():
            continue
        b = json.loads(bj.read_text(encoding="utf-8"))
        entries.append(
            {
                "slug": b["slug"],
                "title": b["title"],
                "titleLines": b.get("titleLines", []),
                "subtitle": b.get("subtitle", ""),
                "theme": b["theme"],
                "cover": f"books/{b['slug']}/{b['cover']}",
                "pageCount": len(b["pages"]),
            }
        )

    def order_key(e):
        try:
            return BOOK_ORDER.index(e["slug"])
        except ValueError:
            return len(BOOK_ORDER)

    entries.sort(key=order_key)
    MANIFEST.write_text(
        json.dumps({"books": entries}, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
