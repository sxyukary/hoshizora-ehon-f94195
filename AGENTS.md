# ほしぞら絵本 — エージェント用の入口

さっくん（7歳）とかなちゃん（4歳）が自分で読むための、星座絵本アプリ。
**設計の正本は [設計図.md](設計図.md)。作業前にまず読むこと。**

公開URL: https://sxyukary.github.io/hoshizora-ehon-f94195/

## いちばん多い依頼：新しい絵本を本棚に追加する

```bash
python3 tools/import_book.py "/Users/sxyukary/Library/Mobile Documents/iCloud~md~obsidian/Documents/2nd-Brain/01_プロジェクト/さっくんの絵本_○○座.html"
```

これで、画像のWebP変換・本文の抽出・`books/<スラッグ>/` の作成・`manifest.json` の更新まで終わる。

事前に `tools/import_book.py` の `SLUG_MAP`（星座名→フォルダ名）と `BOOK_ORDER`（並び順）に
追記が必要な場合がある。テーマ色が既存の本とかぶらないかも `manifest.json` で確認する。

詳しい手順は 2nd-Brain 側の `.agent/workflows/ehon-shelf-add.md` にある。

## 表示を確認する

```bash
python3 -m http.server 8765 --bind 0.0.0.0
```

- Mac: `http://127.0.0.1:8765/`
- iPad: `http://<MacのIP>:8765/`（`ipconfig getifaddr en0` で調べる）
- 特定ページを直接開く: `http://127.0.0.1:8765/#cassiopeia/3`

`file://` で直接開くと絵本データを読み込めない（サーバー経由が必要）。

## 守ること

- **`git push` は公開への反映。必ずゆかりさんの許可を取ってから実行する。**
- 2nd-Brain 側の絵本HTMLと画像フォルダは**読むだけ**。書き換えない。
- 装飾に絵文字を使わない。星などの飾りはSVGで描く（水彩画の絵と質感が合わないため）。
- 本文は左揃え。元の絵本HTMLに合わせている。
- 文章が画面に収まらないときは、`assets/app.js` の `fitText()` が自動で文字を縮める。
  ここを消すと4歳がスクロールすることになる。

## ファイルの役割

| パス | 中身 |
| --- | --- |
| `index.html` | 本棚とよむ画面（1ファイル） |
| `assets/app.css` / `app.js` | 見た目と動き |
| `manifest.json` | 本の一覧（`import_book.py` が自動更新） |
| `books/<スラッグ>/` | `book.json` と ページ画像 |
| `sw.js` | オフライン用（Service Worker） |
| `tools/import_book.py` | 絵本HTML → アプリ用データ の変換 |
| `tools/make_icons.py` | ホーム画面アイコン（星）の生成 |
| `tools/build_mockup.py` | 本棚デザイン比較ページの生成（普段は使わない） |
