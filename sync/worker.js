// ほしぞら絵本の Worker（wrangler.jsonc の main）。/sync/ だけ ここで答え、ほかは アプリのファイル（ASSETS）を返す。
// 「よんだよ」の星を、同じ合言葉の端末どうしで そろえるために預かる。預かるのは 星の番号・本・色・時刻だけ（名前は来ない）。
// Closed by default: without SYNC_KEY (a Worker secret, 12 characters or more) nothing is read or written (罠帖 G-4).
// Same address as the app, so no CORS: a browser call from any other origin is refused.
//   GET  /sync/v1/stars            → {rev, data, at}（まだ無ければ data: null）
//   POST /sync/v1/stars {data}     → 同じ代なら合体して書く。星は減らない（消すのは gone の印だけ）。ちがう代なら 409 life
//   PUT  /sync/v1/stars {data, from} → 置きかえ（ぜんぶ けす・まえの日に もどす）。from が いまの代のときだけ。直前の写しを残す
//   GET  /sync/v1/history[/<日>]   → 30日分の写し
import '../assets/stars.js';
const S = globalThis.Stars;
const MAX_BODY = 2 * 1024 * 1024, KEEP_DAYS = 30, DAY_MS = 86400000, JST = 9 * 3600000, ROW = 'home';
const DAY = /^\d{4}-\d{2}-\d{2}(~\d{6})?$/;
const dayOf = (t) => new Date(t + JST).toISOString().slice(0, 10);
const stampOf = (t) => dayOf(t) + '~' + new Date(t + JST).toISOString().slice(11, 19).replace(/:/g, '');
const size = (d) => d ? Object.keys(d.stars).length : 0;

async function same(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([h(a), h(b)]); let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0;
}
const reply = (status, b) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
async function current(db) {
  const row = await db.prepare('SELECT rev, data, at FROM records WHERE id = ?').bind(ROW).first();
  return row ? { rev: row.rev, data: JSON.parse(row.data), at: row.at } : { rev: 0, data: null, at: 0 };
}
async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return { error: reply(413, { error: 'too-large' }) };
  const text = await req.text(); if (text.length > MAX_BODY) return { error: reply(413, { error: 'too-large' }) };
  let b; try { b = JSON.parse(text); } catch { return { error: reply(400, { error: 'bad-json' }) }; }
  if (!b || typeof b !== 'object' || !S.valid(b.data)) return { error: reply(400, { error: 'bad-shape' }) };
  return { b };
}
// rev が変わっていなければ書く（2台が同時に書いても、片方を消さない）。書けたら その日の写しも残す
async function write(db, old, data, now, keepOld) {
  const text = JSON.stringify(data), rev = old.rev + 1;
  const res = old.rev === 0
    ? await db.prepare('INSERT INTO records (id, rev, data, at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING').bind(ROW, rev, text, now).run()
    : await db.prepare('UPDATE records SET rev = ?, data = ?, at = ? WHERE id = ? AND rev = ?').bind(rev, text, now, ROW, old.rev).run();
  if (res.meta.changes !== 1) return null;
  await db.batch([
    ...(keepOld && old.data ? [db.prepare('INSERT INTO history (day, rev, data, at) VALUES (?, ?, ?, ?) ON CONFLICT (day) DO NOTHING').bind(stampOf(now), old.rev, JSON.stringify(old.data), old.at)] : []),
    db.prepare('INSERT INTO history (day, rev, data, at) VALUES (?, ?, ?, ?) ON CONFLICT (day) DO UPDATE SET rev = excluded.rev, data = excluded.data, at = excluded.at').bind(dayOf(now), rev, text, now),
    db.prepare('DELETE FROM history WHERE day < ?').bind(dayOf(now - (KEEP_DAYS - 1) * DAY_MS)),
  ]);
  return { rev, data, at: now };
}
async function post(db, req, now) {
  const { b, error } = await readBody(req); if (error) return error;
  for (let i = 0; i < 4; i++) {
    const old = await current(db);
    if (old.data && old.data.life !== b.data.life) return reply(409, { error: 'life', ...old });
    const next = old.data ? S.merge(old.data, b.data) : b.data;
    if (Object.keys(next.stars).length > S.MAX || Object.keys(next.gone).length > S.MAX) return reply(422, { error: 'full', ...old });
    if (old.data && S.same(old.data, next)) return reply(200, old);
    const done = await write(db, old, next, now, false);
    if (done) return reply(200, done);
  }
  return reply(409, { error: 'busy', ...await current(db) });
}
async function put(db, req, now) {
  const { b, error } = await readBody(req); if (error) return error;
  const old = await current(db);
  if (old.data && b.from !== old.data.life) return reply(409, { error: 'life', ...old });
  if (old.data && b.data.life === old.data.life) return reply(400, { error: 'same-life' });
  const done = await write(db, old, b.data, now, true);
  return done ? reply(200, done) : reply(409, { error: 'busy', ...await current(db) });
}
export async function handle(req, env, now = Date.now()) {
  const url = new URL(req.url), from = req.headers.get('origin');
  if (from && from !== url.origin) return reply(403, { error: 'origin' });
  const key = typeof env.SYNC_KEY === 'string' ? env.SYNC_KEY : '';
  if (key.length < 12) { console.error('sync: SYNC_KEY is not set'); return reply(503, { error: 'not-configured' }); }
  if (!await same(req.headers.get('x-sync-key') || '', key)) return reply(401, { error: 'key' });
  const m = url.pathname.match(/^\/sync\/v1\/(stars|history)(?:\/([^/]+))?$/);
  if (!m || (m[1] === 'stars' && m[2]) || (m[2] && !DAY.test(m[2]))) return reply(404, { error: 'not-found' });
  const db = env.DB;
  try {
    if (m[1] === 'stars') {
      if (req.method === 'GET') return reply(200, await current(db));
      if (req.method === 'POST') return await post(db, req, now);
      if (req.method === 'PUT') return await put(db, req, now);
      return reply(405, { error: 'method' });
    }
    if (req.method !== 'GET') return reply(405, { error: 'method' });
    if (!m[2]) {
      const { results } = await db.prepare('SELECT day, at, data FROM history ORDER BY day DESC').all();
      return reply(200, { days: results.map((r) => ({ day: r.day, at: r.at, n: size(JSON.parse(r.data)) })) });
    }
    const row = await db.prepare('SELECT day, rev, data, at FROM history WHERE day = ?').bind(m[2]).first();
    return row ? reply(200, { day: row.day, rev: row.rev, data: JSON.parse(row.data), at: row.at }) : reply(404, { error: 'not-found' });
  } catch (e) { console.error('sync:', req.method, url.pathname, e && e.stack || e); return reply(500, { error: 'server' }); }
}
export default {
  fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path === '/sync' || path.startsWith('/sync/')) return handle(req, env);
    return env.ASSETS.fetch(req);
  },
};
