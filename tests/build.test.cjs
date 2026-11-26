// node tests/build.test.cjs … dist/ の中身を確かめる（node tools/build.cjs のあと、公開の前に）
// ・本棚と全冊の絵本が読めるのに必要なファイルがそろっている
// ・作業用のファイル（メモ・道具・比較ページ）が入っていない
// ・公開しない言葉（tools/private_words.txt。Git に入れない）が入っていない
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dist = path.join(root, 'dist');
let fails = 0;
const ng = (m) => { console.error('✖ ' + m); fails++; };
const has = (f) => fs.existsSync(path.join(dist, f));

if (!fs.existsSync(dist)) { console.error('dist がない。先に node tools/build.cjs'); process.exit(1); }

const all = [];
(function walk(rel) {
  for (const e of fs.readdirSync(path.join(dist, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    e.isDirectory() ? walk(r) : all.push(r);
  }
})('');

// 1. アプリの骨組み
for (const f of ['index.html', 'manifest.json', 'app.webmanifest', 'sw.js', 'robots.txt', '_headers',
  'assets/app.js', 'assets/app.css', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png']) {
  if (!has(f)) ng('ない: ' + f);
}
// オフライン用に最初に保存するファイル（sw.js の SHELL_FILES）
const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
for (const m of sw.match(/"\.\/[^"]*"/g) || []) {
  const f = m.slice(3, -1) || 'index.html';
  if (!has(f)) ng('sw.js が保存するのに、ない: ' + f);
}

// 2. 全冊の表紙とページ画像
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
let pages = 0;
for (const b of manifest.books) {
  if (!has(b.cover)) ng(`${b.slug}: 表紙がない ${b.cover}`);
  const bj = path.join(dist, 'books', b.slug, 'book.json');
  if (!fs.existsSync(bj)) { ng(`${b.slug}: book.json がない`); continue; }
  const book = JSON.parse(fs.readFileSync(bj, 'utf8'));
  if (book.pages.length !== b.pageCount) ng(`${b.slug}: ページ数が manifest と違う`);
  for (const p of book.pages) {
    pages++;
    if (!has(`books/${b.slug}/${p.image}`)) ng(`${b.slug}: 画像がない ${p.image}`);
  }
}

// 3. 入っていてはいけないもの
for (const f of all) {
  if (/\.(md|py|cjs|txt|yml|jsonc)$/.test(f) && f !== 'robots.txt') ng('作業用のファイルが入っている: ' + f);
  if (/^(tools|tests|docs|sync)\//.test(f) || f.endsWith(".sql") || f.includes('デザイン案') || f.includes('本文一覧')) ng('入れないものが入っている: ' + f);
}
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('name="robots" content="noindex')) ng('index.html に noindex がない');

// 4. 公開しない言葉
const pw = path.join(root, 'tools', 'private_words.txt');
if (fs.existsSync(pw)) {
  const words = fs.readFileSync(pw, 'utf8').split('\n').map((w) => w.trim()).filter((w) => w && !w.startsWith('#'));
  for (const f of all.filter((f) => /\.(html|js|css|json|webmanifest)$/.test(f))) {
    const t = fs.readFileSync(path.join(dist, f), 'utf8');
    for (const w of words) if (t.includes(w)) ng(`公開しない言葉が入っている: ${f}`);
  }
} else {
  ng('tools/private_words.txt がないので、名前のチェックができない');
}

console.log(`${manifest.books.length}冊・${pages}ページ・${all.length}ファイルを確認`);
if (fails) { console.error(fails + ' 件の問題'); process.exit(1); }
console.log('OK');
