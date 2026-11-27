// 2台の同期：iPad と iPhone に見立てた2つのブラウザを、本物の sync/worker.js（D1 は node:sqlite のにせもの）につなぐ。
// python3 serve.py を動かしてから：NODE_PATH=~/Projects/stamp-rally-template/node_modules node tests/sync-browser.test.cjs [アドレス] [画面を撮るフォルダ]
const { chromium } = require('playwright'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { fakeD1 } = require('./sync.test.cjs');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/', SHOTS = process.argv[3], KEY = 'hoshi-no-aikotoba-1';
(async () => {
  const { handle } = await import('../sync/worker.js');
  const env = { DB: fakeD1(), SYNC_KEY: KEY }, offline = new Set();
  let calls = 0;
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  async function device(name, w, h, before) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await context.route('**/sync/**', async (route) => {
      const r = route.request();
      if (offline.has(name)) return route.abort('internetdisconnected');
      calls++;
      const res = await handle(new Request(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postData() }), env);
      const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
      await route.fulfill({ status: res.status, headers, body: await res.text() }).catch(() => {});
    });
    if (before) await context.addInitScript(before);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE);
    await page.waitForFunction(() => window.hoshizora && window.hoshizora.books.length);
    page.errors = errors;
    return page;
  }
  const rec = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('hoshizora.stars')));
  const count = (r, s, c) => Object.values(r.stars).filter((x) => x.s === s && x.c === c).length;
  const stars = (r) => Object.keys(r.stars).length;
  const settle = (pg) => pg.evaluate(async () => { await window.hoshizora.syncNow(); await window.hoshizora.syncNow(); });
  async function read(pg, slug, colors) {
    await pg.evaluate((s) => window.hoshizora.openBook(s), slug);
    await pg.evaluate(() => window.hoshizora.goTo(window.hoshizora.current.pages.length - 1));
    for (const c of colors) await pg.click(`#done .star-btn[data-c="${c}"]`);
    await pg.click('#back');
  }
  async function setKey(pg, key) {
    await pg.click('#grownOpen');
    await pg.fill('#syncKey', key);
    await pg.click('#syncSave');
    await settle(pg);
    return pg.textContent('#syncStatus');
  }
  // その本の季節の とびらを開いてから、表紙の星を読む
  const coverRows = async (pg, slug) => {
    const s = await pg.evaluate((slug) => window.hoshizora.books.find((b) => b.slug === slug).season, slug);
    await pg.click(`.door[data-season="${s}"]`);
    return pg.$$eval(`.book[data-slug="${slug}"] .stamps .row`, (rs) => rs.map((r) => r.getAttribute('aria-label')));
  };

  try {
    // iPad：前の版の記録がある（はじめに新しい形へ移る）
    const ipad = await device('ipad', 1024, 768, () => {
      if (!localStorage.getItem('moved-once')) {
        localStorage.clear();
        localStorage.setItem('hoshizora.reads', JSON.stringify({ 'orion-scorpio': { b: 2, r: 1 } }));
        localStorage.setItem('hoshizora.sky', JSON.stringify(['b', 'r', 'b']));
        localStorage.setItem('moved-once', '1');
      }
    });
    const slugs = await ipad.evaluate(() => window.hoshizora.books.map((b) => b.slug));
    assert.ok(slugs.includes('orion-scorpio'));
    let r = await rec(ipad);
    assert.equal(count(r, 'orion-scorpio', 'b'), 2); assert.equal(count(r, 'orion-scorpio', 'r'), 1);
    assert.equal(calls, 0, '合言葉を入れるまで 何も送らない');
    // 合言葉：短い → だめ。ちがう → だめ。正しい → そろう
    await ipad.click('#grownOpen');
    await ipad.fill('#syncKey', 'short'); await ipad.click('#syncSave');
    assert.match(await ipad.textContent('#syncStatus'), /12〜64文字/);
    await ipad.click('#grownClose');
    assert.match(await setKey(ipad, 'chigau-aikotoba-99'), /合言葉が ちがいます/);
    await ipad.click('#grownClose');
    assert.match(await setKey(ipad, KEY), /そろっています/);
    if (SHOTS) await ipad.screenshot({ path: path.join(SHOTS, 'sync-ipad-otona.png') });
    await ipad.click('#grownClose');
    const cloud = async () => JSON.parse((await env.DB.prepare('SELECT data FROM records WHERE id = ?').bind('home').first()).data);
    assert.equal(stars(await cloud()), 3);
    assert.ok(!JSON.stringify(await cloud()).includes('moved-once'));

    // iPhone：さきに1冊読んでから合言葉を入れる → 星は足し合わされる
    const phone = await device('phone', 390, 844, () => { if (!sessionStorage.getItem('x')) { localStorage.clear(); sessionStorage.setItem('x', '1'); } });
    await read(phone, 'virgo', ['r']);
    assert.match(await setKey(phone, KEY), /そろっています/);
    await phone.click('#grownClose');
    r = await rec(phone);
    assert.equal(stars(r), 4); assert.equal(count(r, 'virgo', 'r'), 1); assert.equal(count(r, 'orion-scorpio', 'b'), 2);
    // iPad：画面にもどってくると そろう。表紙と夜空も変わる
    await settle(ipad);
    assert.equal(stars(await rec(ipad)), 4);
    assert.deepEqual(await coverRows(ipad, 'virgo'), ['あかい ほし 1かい']);
    assert.equal(await ipad.$$eval('#sky .kira', (k) => k.length), 4);

    // 同じ本を 2台で 同時に読んでも 数がずれない。取り消しは ほかの端末にも届く
    await read(ipad, 'orion-scorpio', ['b']);
    await read(phone, 'orion-scorpio', ['b', 'r', 'r']);   // あかいほしは 押して取り消し
    await settle(phone); await settle(ipad); await settle(phone);
    for (const pg of [ipad, phone]) { r = await rec(pg); assert.equal(count(r, 'orion-scorpio', 'b'), 4); assert.equal(count(r, 'orion-scorpio', 'r'), 1); }

    // つながらないあいだに押した星も、つながったら届く
    offline.add('phone');
    await read(phone, 'virgo', ['b']);
    await settle(phone);
    await phone.click('#grownOpen');
    assert.match(await phone.textContent('#syncStatus'), /つながりません/);
    await phone.click('#grownClose');
    offline.delete('phone');
    await settle(phone); await settle(ipad);
    assert.equal(count(await rec(ipad), 'virgo', 'b'), 1);

    // ぜんぶ けす（iPad）→ iPhone も消える。iPhone が けすの前に知らずに押した星は 消える／けしたあとに押した星は 残る
    await ipad.click('#grownOpen');
    assert.match(await ipad.textContent('#resetStamps'), /すべて/);
    await ipad.click('#resetStamps');
    await ipad.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('hoshizora.stars')).stars).length === 0);
    await ipad.click('#grownClose');
    assert.equal(stars(await cloud()), 0);
    await read(phone, 'gemini', ['b']);
    await settle(phone);
    r = await rec(phone);
    assert.equal(stars(r), 1); assert.equal(count(r, 'gemini', 'b'), 1);
    await settle(ipad);
    assert.equal(stars(await rec(ipad)), 1);
    assert.equal(await ipad.$$eval('#sky .kira', (k) => k.length), 1);

    // まえの日に もどす（けす直前の写し）→ 2台とも もどる
    await ipad.click('#grownOpen');
    await ipad.waitForFunction(() => document.querySelectorAll('#restoreDay option').length >= 2);
    const opt = await ipad.$$eval('#restoreDay option', (os) => os.map((o) => [o.value, o.textContent]));
    const snap = opt.find(([v]) => v.includes('~'));
    assert.ok(snap, JSON.stringify(opt)); assert.match(snap[1], /星7こ/);
    await ipad.selectOption('#restoreDay', snap[0]);
    await ipad.click('#restoreGo');
    await ipad.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('hoshizora.stars')).stars).length === 7);
    await ipad.click('#grownClose');
    await settle(phone);
    assert.equal(stars(await rec(phone)), 7);

    // やめる → 送らない（星は残る）
    await phone.click('#grownOpen'); await phone.click('#syncOff'); await phone.click('#grownClose');
    const before = calls;
    await read(phone, 'orion-scorpio', ['r']); await settle(phone);
    assert.equal(calls, before); assert.equal(stars(await rec(phone)), 8);
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'sync-phone-shelf.png') });

    // おとなのひと の画面が iPhone の中に収まる
    await phone.click('#grownOpen');
    const box = await phone.$eval('#grown', (d) => d.getBoundingClientRect().toJSON());
    assert.ok(box.left >= 0 && box.right <= 390 && box.top >= 0 && box.bottom <= 844, JSON.stringify(box));
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'sync-phone-otona.png') });

    for (const pg of [ipad, phone]) assert.deepEqual(pg.errors, []);
    console.log('OK 2台の同期');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
