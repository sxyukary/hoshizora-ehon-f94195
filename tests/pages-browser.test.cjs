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
  let fails = 0, checked = 0, minFit = 1, minPs = 1;
  const small = [];
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const [name, w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const bad = [];
    page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
    page.on('pageerror', (e) => bad.push('エラー ' + e.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const books = await page.evaluate(() => window.hoshizora.books.map((b) => b.slug));
    // 本棚は 季節の とびらごと。4つの季節を ぜんぶ開くと 全冊がそろう（どの季節にも1冊以上）
    const perSeason = await page.evaluate(async () => {
      const out = {};
      for (const k of ['haru', 'natsu', 'aki', 'fuyu']) {
        document.querySelector(`.door[data-season="${k}"]`).click();
        await new Promise((r) => setTimeout(r, 30));
        out[k] = [...document.querySelectorAll('#rail > .book')].map((b) => b.dataset.slug);
      }
      return out;
    });
    const shelved = Object.values(perSeason).flat();
    if (shelved.length !== books.length || books.some((s) => !shelved.includes(s)) || Object.values(perSeason).some((l) => !l.length)) {
      console.error(`✖ ${name}: 本棚の季節 ${JSON.stringify(perSeason)}`); fails++;
    }
    for (const slug of books) {
      await page.evaluate((s) => window.hoshizora.openBook(s), slug);
      const n = await page.evaluate(() => window.hoshizora.current.pages.length);
      const picSizes = new Set();   // めくっても 絵の大きさが変わらないこと（星のボタンが出る さいごのページは のぞく）
      for (let i = 0; i < n; i++) {
        await page.evaluate((i) => window.hoshizora.goTo(i), i);
        await page.waitForFunction(() => { const im = document.getElementById('pic'); return im.complete && im.naturalWidth > 0; }, null, { timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(60);
        const r = await page.evaluate(() => {
          const t = document.getElementById('text'), im = document.getElementById('pic');
          const ps = parseFloat(document.getElementById('picBox').style.getPropertyValue('--ps')) || 1;
          const box = document.getElementById('picBox').getBoundingClientRect();
          return { pic: Math.round(box.width) + 'x' + Math.round(box.height), over: t.scrollHeight - t.clientHeight, fit: parseFloat(getComputedStyle(t).getPropertyValue('--fit')) || 1, ps, img: im.naturalWidth > 0 };
        });
        checked++;
        if (i < n - 1) picSizes.add(r.pic);
        minFit = Math.min(minFit, r.fit); minPs = Math.min(minPs, r.ps);
        if (r.fit < 0.8) small.push(`${name} ${slug}/${i + 1} ${r.fit}`);
        if (r.over > 1) { console.error(`✖ ${name} ${slug}/${i + 1}: 文字が ${r.over}px はみ出し`); fails++; }
        if (!r.img) { console.error(`✖ ${name} ${slug}/${i + 1}: 絵が出ていない`); fails++; }
        if (shots && i === n - 1 && slug === books[0]) await page.screenshot({ path: path.join(shots, `${name}.png`) });
      }
      if (picSizes.size > 1) { console.error(`✖ ${name} ${slug}: めくると絵の大きさが変わる ${[...picSizes].join(' / ')}`); fails++; }
      await page.click('#back');
    }
    if (bad.length) { console.error(`✖ ${name}: ` + [...new Set(bad)].join('\n  ')); fails++; }
    await page.close();
  }
  await browser.close();
  console.log(`${SIZES.length}種類の画面 × 全ページ = ${checked}画面を確認。いちばん縮んだ文字 ${minFit.toFixed(2)}倍・絵 ${minPs.toFixed(2)}倍`);
  if (small.length) console.log(`字が 0.8倍より小さい画面 ${small.length}: ` + small.join(' / '));
  if (fails) { console.error(fails + ' 件の問題'); process.exit(1); }
  console.log('OK');
})();
