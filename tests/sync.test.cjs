// 星の記録の形（assets/stars.js）と、同期の Worker（sync/worker.js）を確かめる。node tests/sync.test.cjs
// D1 の代わりに node:sqlite と本物の表（sync/migrations）を使う
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { DatabaseSync } = require('node:sqlite');
require('../assets/stars.js');
const St = globalThis.Stars;
function fakeD1() {
  const db = new DatabaseSync(':memory:'), dir = path.join(__dirname, '../sync/migrations');
  for (const f of fs.readdirSync(dir).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }) });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
module.exports = { fakeD1 };
if (require.main !== module) return;

const KEY = 'test-key-abcdef', SITE = 'https://ehon.example', T0 = Date.UTC(2026, 10, 26, 3), DAY = 86400000;
(async () => {
  // ---- 記録の形 ----
  const a = St.fresh(T0), b = { ...St.fresh(T0), life: a.life };
  const x = St.add(a, 'orion', 'b', T0 + 1), y = St.add(b, 'orion', 'r', T0 + 2);
  St.add(b, 'virgo', 'b', T0 + 3);
  let m = St.merge(a, b);
  assert.deepEqual(St.counts(m), { orion: { b: 1, r: 1 }, virgo: { b: 1, r: 0 } });
  assert.deepEqual(St.sky(m), ['b', 'r', 'b']);
  assert.ok(St.same(St.merge(m, a), m), '何度合体しても同じ');
  assert.ok(St.remove(b, y, T0 + 4));
  m = St.merge(m, b);
  assert.deepEqual(St.counts(m).orion, { b: 1, r: 0 }, '取り消しは ほかの端末にも届く');
  assert.ok(St.same(St.merge(a, m), m), '取り消した星は 戻ってこない');
  assert.ok(St.valid(m));
  for (const bad of [{ ...m, v: 2 }, { ...m, name: 'x' }, { ...m, stars: { abcdef1: { s: 'orion', c: 'g', t: 1 } } },
    { ...m, stars: { abcdef1: { s: 'orion', c: 'b', t: 1, who: 'x' } } }, { ...m, stars: { 'A!': { s: 'orion', c: 'b', t: 1 } } }, { ...m, gone: { abcdef1: -1 } }])
    assert.ok(!St.valid(bad), JSON.stringify(bad).slice(0, 60));
  // 前の版の記録から
  const old = St.fromOld({ orion: { b: 2, r: 1 }, virgo: { b: 0, r: 1 } }, ['r', 'b', 'b', 'r'], T0);
  assert.deepEqual(St.counts(old), { orion: { b: 2, r: 1 }, virgo: { b: 0, r: 1 } });
  assert.deepEqual(St.sky(old), ['r', 'b', 'b', 'r']);
  assert.ok(St.valid(old) && old.since < T0);
  // 置きかえのあとに押した星だけ持っていく
  const c2 = St.fresh(T0 + 100);
  const kept = St.carry(c2, St.merge(m, { ...St.fresh(), life: m.life, stars: { late00001: { s: 'virgo', c: 'r', t: T0 + 200 } } }));
  assert.deepEqual(St.counts(kept), { virgo: { b: 0, r: 1 } });
  assert.equal(kept.life, c2.life);

  // ---- Worker ----
  const { handle } = await import('../sync/worker.js');
  const env = { DB: fakeD1(), SYNC_KEY: KEY };
  const call = async (method, p, { body, key = KEY, origin = null, now = T0, e = env } = {}) => {
    const h = {}; if (key !== null) h['x-sync-key'] = key; if (origin) h.origin = origin; if (body !== undefined) h['content-type'] = 'application/json';
    const res = await handle(new Request(SITE + p, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), e, now);
    return { status: res.status, headers: res.headers, body: JSON.parse(await res.text()) };
  };
  const errors = []; const log = console.error; console.error = (...v) => errors.push(v.join(' '));
  // 合言葉がない・短い → 閉じる。ちがう → 401
  for (const k of [undefined, '', 'short']) assert.equal((await call('GET', '/sync/v1/stars', { e: { ...env, SYNC_KEY: k } })).status, 503);
  assert.ok(errors.length >= 3); errors.length = 0;
  for (const key of [null, KEY + 'x', 'Test-key-abcdef']) assert.equal((await call('GET', '/sync/v1/stars', { key })).status, 401);
  assert.equal((await call('GET', '/sync/v1/stars', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('GET', '/sync/v1/stars', { origin: SITE })).status, 200);
  let r = await call('GET', '/sync/v1/stars');
  assert.deepEqual(r.body, { rev: 0, data: null, at: 0 }); assert.equal(r.headers.get('cache-control'), 'no-store');
  for (const p of ['/sync/v1/stars/x', '/sync/v1/history/2026-1-1', '/sync/', '/sync/v2/stars', '/sync/v1/records'])
    assert.equal((await call('GET', p)).status, 404, p);
  assert.equal((await call('DELETE', '/sync/v1/stars')).status, 405);
  assert.equal((await call('POST', '/sync/v1/history')).status, 405);
  // 1台目が書く → 2台目（同じ代）が合体
  r = await call('POST', '/sync/v1/stars', { body: { data: a } }); assert.equal(r.status, 200); assert.equal(r.body.rev, 1);
  r = await call('POST', '/sync/v1/stars', { body: { data: b }, now: T0 + 10 }); assert.equal(r.status, 200);
  assert.deepEqual(St.counts(r.body.data), { orion: { b: 1, r: 0 }, virgo: { b: 1, r: 0 } });
  const rev = r.body.rev;
  // 同じものをもう一度 → 書かない
  r = await call('POST', '/sync/v1/stars', { body: { data: b } }); assert.equal(r.body.rev, rev);
  // 古い端末が 取り消した星を持っていても 戻らない
  r = await call('POST', '/sync/v1/stars', { body: { data: { ...a, stars: { ...a.stars, [y]: { s: 'orion', c: 'r', t: T0 + 2 } } } } });
  assert.equal(St.counts(r.body.data).orion.r, 0);
  // ちがう代は合体しない
  r = await call('POST', '/sync/v1/stars', { body: { data: St.fresh(T0) } }); assert.equal(r.status, 409); assert.equal(r.body.error, 'life');
  // 変な形・大きすぎ
  for (const data of [{ ...a, v: 2 }, { ...a, who: 'x' }, null]) assert.equal((await call('POST', '/sync/v1/stars', { body: { data } })).status, 400);
  assert.equal((await call('POST', '/sync/v1/stars', { body: '{' })).status, 400);
  assert.equal((await call('POST', '/sync/v1/stars', { body: { data: a, pad: 'x'.repeat(2.1 * 1024 * 1024) } })).status, 413);
  // ぜんぶ けす = 新しい代へ置きかえ。いまの代を知っている端末だけ。直前の写しが残る
  const before = (await call('GET', '/sync/v1/stars')).body;
  const empty = St.fresh(T0 + DAY);
  r = await call('PUT', '/sync/v1/stars', { body: { data: empty, from: 'zzzzzzzz' }, now: T0 + DAY }); assert.equal(r.status, 409);
  r = await call('PUT', '/sync/v1/stars', { body: { data: { ...empty, life: a.life }, from: a.life }, now: T0 + DAY }); assert.equal(r.status, 400);
  r = await call('PUT', '/sync/v1/stars', { body: { data: empty, from: a.life }, now: T0 + DAY }); assert.equal(r.status, 200);
  assert.equal(r.body.data.life, empty.life);
  r = await call('GET', '/sync/v1/history', { now: T0 + DAY });
  const days = r.body.days.map((d) => d.day);
  assert.equal(days.length, 3, JSON.stringify(days));   // 前の日・けす直前の写し・けしたあと
  const snap = r.body.days.find((d) => d.day.includes('~'));
  assert.equal(snap.n, 2);
  r = await call('GET', '/sync/v1/history/' + snap.day); assert.deepEqual(r.body.data, before.data);
  // 30日より前の写しは消える
  await call('POST', '/sync/v1/stars', { body: { data: { ...empty, stars: { late00002: { s: 'orion', c: 'b', t: T0 + 40 * DAY } } } }, now: T0 + 40 * DAY });
  r = await call('GET', '/sync/v1/history'); assert.deepEqual(r.body.days.map((d) => d.day), [new Date(T0 + 40 * DAY + 9 * 3600000).toISOString().slice(0, 10)]);
  // データベースが壊れたら 500 と記録（だまらない）
  r = await call('GET', '/sync/v1/stars', { e: { ...env, DB: { prepare: () => { throw new Error('boom'); } } } });
  assert.equal(r.status, 500); assert.ok(errors.some((e) => e.includes('boom')));
  console.error = log;
  console.log('OK sync');
})().catch((e) => { console.error(e); process.exit(1); });
