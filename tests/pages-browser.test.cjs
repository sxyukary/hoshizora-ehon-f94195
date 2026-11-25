// 全冊・全ページを iPhone / iPad の縦横で開き、文字がはみ出していないか・絵が出ているかを確かめる
// 使い方: python3 serve.py を動かしてから
//   NODE_PATH=~/Projects/stamp-rally-template/node_modules node tests/pages-browser.test.cjs [アドレス] [画面を撮るフォルダ]
// アドレスを省くと http://127.0.0.1:8765/ 。公開先を確かめるときは公開アドレスを渡す
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const shots = process.argv[3];
const SIZES = [
  ['iPhone縦', 390, 844], ['iPhone横', 844, 390], ['iPhone大縦', 430, 932],
  ['iPad縦', 768, 1024], ['iPad横', 1024, 768], ['iPadAir縦', 820, 1180], ['iPadAir横', 1180, 820],
];

(async () => {
  // Playwright 用のブラウザが入っていなければ、Mac の Google Chrome を使う
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  let fails = 0, checked = 0, minFit = 1;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const [name, w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const bad = [];
    page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
    page.on('pageerror', (e) => bad.push('エラー ' + e.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const books = await page.evaluate(() => window.hoshizora.books.map((b) => b.slug));
    const cards = await page.locator('#rail > *').count();
    if (cards !== books.length) { console.error(`✖ ${name}: 本棚のカード ${cards} / ${books.length}冊`); fails++; }
    for (const slug of books) {
      await page.evaluate((s) => window.hoshizora.openBook(s), slug);
      const n = await page.evaluate(() => window.hoshizora.current.pages.length);
      for (let i = 0; i < n; i++) {
        await page.evaluate((i) => window.hoshizora.goTo(i), i);
        await page.waitForFunction(() => { const im = document.getElementById('pic'); return im.complete && im.naturalWidth > 0; }, null, { timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(60);
        const r = await page.evaluate(() => {
          const t = document.getElementById('text'), im = document.getElementById('pic');
          return { over: t.scrollHeight - t.clientHeight, fit: parseFloat(getComputedStyle(t).getPropertyValue('--fit')) || 1, img: im.naturalWidth > 0 };
        });
        checked++;
        minFit = Math.min(minFit, r.fit);
        if (r.over > 1) { console.error(`✖ ${name} ${slug}/${i + 1}: 文字が ${r.over}px はみ出し`); fails++; }
        if (!r.img) { console.error(`✖ ${name} ${slug}/${i + 1}: 絵が出ていない`); fails++; }
        if (shots && i === n - 1 && slug === books[0]) await page.screenshot({ path: path.join(shots, `${name}.png`) });
      }
      await page.click('#back');
    }
    if (bad.length) { console.error(`✖ ${name}: ` + [...new Set(bad)].join('\n  ')); fails++; }
    await page.close();
  }
  await browser.close();
  console.log(`${SIZES.length}種類の画面 × 全ページ = ${checked}画面を確認。いちばん縮んだ文字 ${minFit.toFixed(2)}倍`);
  if (fails) { console.error(fails + ' 件の問題'); process.exit(1); }
  console.log('OK');
})();
