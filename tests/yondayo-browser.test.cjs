// 「よんだよ」（ふたり分の星・表紙の回数・本棚の上の夜空）が、iPhone / iPad の縦横で動いて収まっているか
// 使い方: python3 serve.py を動かしてから
//   NODE_PATH=~/Projects/stamp-rally-template/node_modules node tests/yondayo-browser.test.cjs [アドレス] [画面を撮るフォルダ]
const { chromium } = require('playwright');
require('../assets/stars.js');
const Stars = globalThis.Stars;
const fs = require('fs'), path = require('path');
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const shots = process.argv[3];
const SIZES = [
  ['iPhone縦', 390, 844], ['iPhone横', 844, 390], ['iPhone大縦', 430, 932],
  ['iPad縦', 768, 1024], ['iPad横', 1024, 768], ['iPadAir縦', 820, 1180], ['iPadAir横', 1180, 820],
];
const inside = (r, w, h) => r.left >= -1 && r.top >= -1 && r.right <= w + 1 && r.bottom <= h + 1;

(async () => {
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  let fails = 0;
  const fail = (m) => { fails++; console.log('NG', m); };
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const [name, w, h] of SIZES) {
    // 初回はオフライン用の仕組みが入ると自動で読み直すので、テストでは止める
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.hoshizora && window.hoshizora.books.length);
    const slug = await page.evaluate(() => window.hoshizora.books[0].slug);
    await page.evaluate((s) => window.hoshizora.openBook(s), slug);
    await page.evaluate(() => window.hoshizora.goTo(window.hoshizora.current.pages.length - 1));
    // さいごのページ：星のボタンが2つ、画面の中に見えている
    const btns = await page.$$eval('#done .star-btn', (bs) => bs.map((b) => b.getBoundingClientRect().toJSON()));
    if (btns.length !== 2) fail(`${name}: 星のボタンが ${btns.length} こ`);
    btns.forEach((r, i) => { if (!inside(r, w, h)) fail(`${name}: 星のボタン${i + 1} が画面の外`); });
    // あかい星を押す → もう一度押すと取り消し → あおじろい星とあかい星を押す
    await page.click('#done .star-btn[data-c="r"]');
    await page.click('#done .star-btn[data-c="r"]');
    await page.click('#done .star-btn[data-c="b"]');
    await page.click('#done .star-btn[data-c="r"]');
    if (shots) await page.screenshot({ path: path.join(shots, `${name}-last.png`) });
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('hoshizora.stars')));
    const c = Stars.counts(rec)[slug];
    if (!c || c.b !== 1 || c.r !== 1 || Object.keys(rec.gone).length !== 1) fail(`${name}: 記録がおかしい ${JSON.stringify(rec)}`);
    // 本棚へ。たくさん読んだことにして、表紙と夜空が収まるか（ほかの本の星もまぜて夜空を60こに）
    await page.evaluate((s) => {
      const r = Stars.fresh();
      for (let i = 0; i < 12; i++) Stars.add(r, s, 'b', 1000 + i);
      for (let i = 0; i < 3; i++) Stars.add(r, s, 'r', 2000 + i);
      for (let i = 0; i < 45; i++) Stars.add(r, 'gemini', i % 3 ? 'b' : 'r', 3000 + i);
      localStorage.setItem('hoshizora.stars', JSON.stringify(r));
    }, slug);
    await page.click('#back');
    await page.waitForTimeout(300);
    const shelf = await page.evaluate((s) => {
      // 本棚に もどると、読んだ本の季節が開いて その本が まんなかに来る
      const book = document.querySelector(`.book[data-slug="${s}"]`);
      const card = book.getBoundingClientRect().toJSON();
      const sky = document.getElementById('sky');
      const rows = [...book.querySelectorAll('.stamps .row')].map((r) => r.textContent.trim());
      const mid = Math.abs(card.left + card.width / 2 - innerWidth / 2) < 4;
      // 夜空の星は 時計の下の ぼかし（上から14px）より下、本の上より上
      const kira = [...sky.querySelectorAll('.kira')].map((k) => k.getBoundingClientRect());
      const outside = kira.filter((r) => r.top + r.height / 2 < 14 || r.top + r.height / 2 > card.top || r.left + r.width / 2 < 0 || r.left + r.width / 2 > innerWidth).length;
      return { card, mid, outside, skyShown: getComputedStyle(sky).display !== 'none', skyN: kira.length,
        scroll: document.documentElement.scrollHeight - innerHeight, rows };
    }, slug);
    if (!shelf.mid) fail(`${name}: 読んだ本が まんなかに来ていない`);
    if (shelf.skyShown && shelf.outside) fail(`${name}: 夜空の帯から はみ出した星 ${shelf.outside}こ`);
    if (!inside(shelf.card, Infinity, h)) fail(`${name}: 表紙のカードが下にはみ出す ${Math.round(shelf.card.bottom)} > ${h}`);
    if (h > 500 && (!shelf.skyShown || shelf.skyN !== 60)) fail(`${name}: 夜空の星 ${shelf.skyN}`);
    if (shelf.rows[0] !== '12') fail(`${name}: 6こ以上が「星1つ＋数字」になっていない ${JSON.stringify(shelf.rows)}`);
    if (shots) await page.screenshot({ path: path.join(shots, `${name}-shelf.png`) });
    console.log(`${name}: ボタン${btns.length} 夜空${shelf.skyShown ? shelf.skyN : 'なし'} 表紙下端 ${Math.round(shelf.card.bottom)}/${h}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? `NG ${fails}件` : 'OK');
  process.exit(fails ? 1 : 0);
})();
