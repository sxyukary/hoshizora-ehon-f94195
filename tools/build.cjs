// node tools/build.cjs … 公開用に、アプリに使うファイルだけを dist/ に写す（Cloudflare Workers に送る前に。wrangler.jsonc）
// 配るものは「決まったファイル」と「決まったフォルダの決まった種類」だけ。serve.py も同じ決まり（tools/publish.json）を使う
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist');
const rule = JSON.parse(fs.readFileSync(path.join(__dirname, 'publish.json'), 'utf8'));
const ext = new Set(rule.extensions);

function list() {
  const files = [...rule.files];
  for (const dir of rule.dirs) {
    (function walk(rel) {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const r = path.posix.join(rel, e.name);
        if (e.isDirectory()) walk(r);
        else if (e.isFile() && ext.has(path.extname(e.name))) files.push(r);
      }
    })(dir);
  }
  return files;
}

if (require.main === module) {
  fs.rmSync(out, { recursive: true, force: true });
  const files = list();
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(out, f));
  }
  console.log(files.length + ' files → dist/');
}
module.exports = { list };
