#!/usr/bin/env python3
"""本棚デザイン案の比較ページを生成する。

JavaScript を一切使わない（CSSのラジオボタンだけで案を切り替える）。
表紙画像もBase64で埋め込むので、ダブルクリックで開くだけで見られる。

使い方:
    python3 tools/build_mockup.py
"""
import base64
import io
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "デザイン案.html"

BOOKS = [
    dict(slug="orion",      theme="#f39c12", pages=12, stamps=3,
         lines=["おほしさまの かりうど", "オリオン"]),
    dict(slug="gemini",     theme="#1a8cb8", pages=12, stamps=1,
         lines=["ふたごの おほしさま", "カストルと ポルックス"]),
    dict(slug="ursa-major", theme="#33499b", pages=8,  stamps=0,
         lines=["よぞらに うかぶ", "親子グマ"]),
    dict(slug="cassiopeia", theme="#6F5CC2", pages=11, stamps=5,
         lines=["北の空の女王", "カシオペア"]),
    dict(slug="virgo",      theme="#2ecc71", pages=10, stamps=0,
         lines=["おそらの おとめ", "コムギの ほしスピカ"]),
]


def cover_uri(slug, box=440):
    img = Image.open(ROOT / "books" / slug / "p01.webp").convert("RGB")
    img.thumbnail((box, box), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=80, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def stamps(n):
    return f'<div class="stamps">{"⭐" * min(n, 5)}</div>' if n else ""


def card(b, uri, style):
    """style: 'A' 枠が光る / 'B' 白いカード / 'C' 大きいカード"""
    title = "<br>".join(b["lines"])
    meta = f'<div class="n">{b["pages"]}ページ</div>'
    if style == "A":
        return f'''      <button class="card" style="--th:{b['theme']}">
        <div class="thumb"><img src="{uri}" alt="">{stamps(b['stamps'])}</div>
        <div class="t">{title}</div>{meta}
      </button>'''
    bar = '<div class="bar"></div>' if style == "B" else ""
    return f'''      <button class="card" style="--th:{b['theme']}">
        {bar}<div class="thumb"><img src="{uri}" alt="">{stamps(b['stamps'])}</div>
        <div class="body"><div class="t">{title}</div>{meta}</div>
      </button>'''


def main():
    uris = {b["slug"]: cover_uri(b["slug"]) for b in BOOKS}
    a = "\n".join(card(b, uris[b["slug"]], "A") for b in BOOKS)
    bb = "\n".join(card(b, uris[b["slug"]], "B") for b in BOOKS)
    c = "\n".join(card(b, uris[b["slug"]], "C") for b in BOOKS)
    dots = "".join(f'<i class="{"on" if i == 0 else ""}"></i>' for i in range(len(BOOKS)))

    OUT.write_text(TEMPLATE.format(A=a, B=bb, C=c, DOTS=dots), encoding="utf-8")
    print(f"生成しました: {OUT.name}  ({OUT.stat().st_size / 1024:.0f}KB, JavaScriptなし)")


TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>ほしぞら絵本 — 本棚デザイン案</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap" rel="stylesheet">
<style>
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; }}
body {{
  font-family: 'Zen Maru Gothic', 'Hiragino Maru Gothic ProN', sans-serif;
  -webkit-font-smoothing: antialiased; background: #e9ecf2;
}}

/* 案を切り替えるラジオボタン（JavaScriptを使わないための仕掛け） */
.pick {{ position: absolute; opacity: 0; pointer-events: none; }}

.chooser {{
  position: sticky; top: 0; z-index: 100;
  background: #22252e; color: #fff; padding: 10px 14px;
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  box-shadow: 0 2px 12px rgba(0,0,0,.25);
}}
.chooser .label {{ font-size: 13px; opacity: .7; margin-right: 4px; }}
.chooser label {{
  font-size: 15px; font-weight: 700; border-radius: 999px;
  padding: 9px 18px; cursor: pointer; background: #3a3f4c; color: #fff;
  user-select: none;
}}
.note {{
  background: #fffbe8; color: #6b5518; font-size: 13px;
  padding: 10px 16px; line-height: 1.75; border-bottom: 1px solid #e8dcae;
}}

.stage {{ display: none; }}
#pA:checked ~ .stages #A,
#pB:checked ~ .stages #B,
#pC:checked ~ .stages #C {{ display: block; }}
#pA:checked ~ .chooser label[for="pA"],
#pB:checked ~ .chooser label[for="pB"],
#pC:checked ~ .chooser label[for="pC"] {{ background: #fff; color: #22252e; }}

/* ===== 共通 ===== */
.card {{
  border: 0; padding: 0; font-family: inherit; cursor: pointer;
  transition: transform .15s;
}}
.card:active {{ transform: scale(.96); }}
.stamps {{
  position: absolute; top: 7px; right: 8px; display: flex; gap: 1px;
  font-size: 15px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.6));
}}
.thumb img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
/* 日本語が語のとちゅうで折り返さないようにする */
.t {{ word-break: keep-all; overflow-wrap: break-word; }}

/* ============ 案A よぞらの ほんだな ============ */
#A {{
  min-height: 88vh; position: relative; overflow: hidden; padding: 34px 20px 56px;
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, #24407e 0%, transparent 70%),
    linear-gradient(180deg, #0e1a3c 0%, #16224a 55%, #1d2b58 100%);
}}
#A::before {{
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .85;
  background-image:
    radial-gradient(1.6px 1.6px at 12% 14%, #fff 50%, transparent),
    radial-gradient(1.2px 1.2px at 78% 9%, #ffe9b0 50%, transparent),
    radial-gradient(1.8px 1.8px at 34% 30%, #fff 50%, transparent),
    radial-gradient(1.1px 1.1px at 62% 22%, #cfe4ff 50%, transparent),
    radial-gradient(1.4px 1.4px at 89% 38%, #fff 50%, transparent),
    radial-gradient(1.2px 1.2px at 20% 52%, #ffe9b0 50%, transparent),
    radial-gradient(1.6px 1.6px at 50% 66%, #fff 50%, transparent),
    radial-gradient(1.1px 1.1px at 8% 78%, #cfe4ff 50%, transparent),
    radial-gradient(1.5px 1.5px at 71% 84%, #fff 50%, transparent),
    radial-gradient(1.2px 1.2px at 93% 62%, #ffe9b0 50%, transparent);
}}
#A .head {{ position: relative; text-align: center; margin-bottom: 30px; }}
#A .head h1 {{
  margin: 0; font-size: clamp(26px, 6vw, 38px); font-weight: 700; color: #fff;
  letter-spacing: .06em; text-shadow: 0 0 22px rgba(150,190,255,.6);
}}
#A .head p {{ margin: 8px 0 0; color: #a8bce4; font-size: 14px; }}
#A .grid {{
  position: relative; display: grid; gap: 22px;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  max-width: 1100px; margin: 0 auto;
}}
#A .card {{ background: none; text-align: center; color: #fff; }}
#A .thumb {{
  position: relative; border-radius: 20px; overflow: hidden; aspect-ratio: 1/1;
  border: 3px solid var(--th);
  box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 10px 26px rgba(0,0,0,.5),
              0 0 24px -6px var(--th);
}}
#A .t {{ margin-top: 11px; font-size: 15px; font-weight: 700; line-height: 1.45; }}
#A .n {{ margin-top: 3px; font-size: 12px; color: #9fb4dd; }}

/* ============ 案B あかるい ほんだな ============ */
#B {{ min-height: 88vh; background: #f6f8fb; padding: 30px 20px 56px; }}
#B .head {{ text-align: center; margin-bottom: 28px; }}
#B .head h1 {{
  margin: 0; font-size: clamp(25px, 5.5vw, 34px); font-weight: 700; color: #2c3e50;
}}
#B .head p {{ margin: 7px 0 0; color: #8b97a8; font-size: 14px; }}
#B .grid {{
  display: grid; gap: 20px; align-items: stretch;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  max-width: 1100px; margin: 0 auto;
}}
#B .card {{
  background: #fff; border-radius: 24px; overflow: hidden; height: 100%;
  box-shadow: 0 10px 30px rgba(0,0,0,.08);
  display: flex; flex-direction: column;
}}
#B .body {{ flex: 1; display: flex; flex-direction: column; justify-content: center; }}
#B .bar {{ height: 7px; background: var(--th); }}
#B .thumb {{ position: relative; aspect-ratio: 1/1; background: #f8f5ef; }}
#B .body {{ padding: 12px 12px 15px; text-align: center; }}
#B .t {{ font-size: 15px; font-weight: 700; color: #333; line-height: 1.45; }}
#B .n {{ margin-top: 5px; font-size: 12px; color: #98a3b3; }}

/* ============ 案C おおきなカード ============ */
#C {{
  min-height: 88vh; padding: 22px 0 30px;
  background: linear-gradient(180deg, #1a2a52 0%, #2b3f70 100%);
}}
#C .head {{ text-align: center; margin-bottom: 16px; }}
#C .head h1 {{
  margin: 0; font-size: clamp(24px, 5.5vw, 32px); font-weight: 700; color: #fff;
  text-shadow: 0 0 20px rgba(150,190,255,.5);
}}
#C .rail {{
  --cw: min(76vw, 420px);
  display: flex; gap: 20px; overflow-x: auto; scroll-snap-type: x mandatory;
  padding: 10px calc((100vw - var(--cw)) / 2) 18px;
  -webkit-overflow-scrolling: touch; scrollbar-width: none;
}}
#C .rail::-webkit-scrollbar {{ display: none; }}
#C .card {{
  flex: 0 0 var(--cw); scroll-snap-align: center; background: #fff;
  border-radius: 28px; overflow: hidden; border: 5px solid var(--th);
  box-shadow: 0 16px 40px rgba(0,0,0,.45);
  display: flex; flex-direction: column;
}}
#C .thumb {{ position: relative; aspect-ratio: 1/1; }}
#C .stamps {{ top: 10px; right: 12px; font-size: 22px; gap: 2px; }}
#C .body {{ padding: 16px 16px 20px; text-align: center; }}
#C .t {{ font-size: clamp(18px, 4.6vw, 22px); font-weight: 700; color: #333; line-height: 1.5; }}
#C .n {{ margin-top: 8px; font-size: 14px; color: #98a3b3; }}
#C .hint {{ text-align: center; color: #b9cbef; font-size: 15px; margin-top: 6px; }}
#C .dots {{ display: flex; justify-content: center; gap: 9px; margin-top: 14px; }}
#C .dots i {{
  width: 11px; height: 11px; border-radius: 50%; display: block;
  background: rgba(255,255,255,.32);
}}
#C .dots i.on {{ background: #fff; }}
@media (min-width: 900px) {{ #C .rail {{ --cw: 360px; }} }}
</style>
</head>
<body>

<input class="pick" type="radio" name="pick" id="pA" checked>
<input class="pick" type="radio" name="pick" id="pB">
<input class="pick" type="radio" name="pick" id="pC">

<div class="chooser">
  <span class="label">本棚デザイン案</span>
  <label for="pA">案A よぞら</label>
  <label for="pB">案B あかるい</label>
  <label for="pC">案C おおきなカード</label>
</div>

<div class="stages">
  <div class="note">
    この黒いバーは案を見比べるためのもので、アプリ本体には入りません。
    ⭐は「読んだ回数スタンプ」の見え方の例です（実際は0から始まります）。
    ブラウザの幅を変えたり、iPadを縦横に回すと、並び方が変わるのも確認できます。
  </div>

  <div class="stage" id="A">
    <div class="head">
      <h1>✨ ほしぞら絵本 ✨</h1>
      <p>よみたい ほんを えらんでね</p>
    </div>
    <div class="grid">
{A}
    </div>
  </div>

  <div class="stage" id="B">
    <div class="head">
      <h1>ほしぞら絵本</h1>
      <p>よみたい ほんを えらんでね</p>
    </div>
    <div class="grid">
{B}
    </div>
  </div>

  <div class="stage" id="C">
    <div class="head"><h1>✨ ほしぞら絵本 ✨</h1></div>
    <div class="rail">
{C}
    </div>
    <div class="dots">{DOTS}</div>
    <p class="hint">よこに すべらせて えらぶ</p>
  </div>
</div>

</body>
</html>
"""

if __name__ == "__main__":
    main()
