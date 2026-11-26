/* ほしぞら絵本 — 「よんだよ」の記録の形と合体（アプリ・同期の Worker・テストで共通）
   記録 = { v: 1, life: 代の番号, since: 代のはじまり(ms), stars: { 星の番号: { s: 本, c: "b"|"r", t: 押した時刻 } }, gone: { 星の番号: 消した時刻 } }
   ・星は1こずつ番号を持つ。2台で同じ星を押しても数がずれず、何度合体しても同じ結果になる
   ・「もう一度押して取り消し」は gone に印を残す（ほかの端末から戻ってこないように）
   ・「ぜんぶ けす」「まえの日に もどす」は 新しい代（life）にする。合体ではなく置きかえ
   名前はどこにも入らない。色だけ */
(function (g) {
  "use strict";
  const COLORS = ["b", "r"];
  const ID = /^[a-z0-9]{6,20}$/, SLUG = /^[a-z0-9-]{1,40}$/;
  const MAX = 20000;                      // 1つの代に持てる星と印の数（ふつうは数百）
  const plain = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const time = (n) => Number.isSafeInteger(n) && n >= 0;

  const newId = () => {
    const a = new Uint8Array(8);
    (g.crypto || globalThis.crypto).getRandomValues(a);
    return Array.from(a, (x) => (x % 36).toString(36)).join("") + Date.now().toString(36).slice(-4);
  };
  const fresh = (now = Date.now(), life = newId()) => ({ v: 1, life, since: now, stars: {}, gone: {} });

  function valid(r) {
    if (!plain(r) || r.v !== 1 || typeof r.life !== "string" || !ID.test(r.life) || !time(r.since)) return false;
    if (!plain(r.stars) || !plain(r.gone)) return false;
    const ks = Object.keys(r.stars), gs = Object.keys(r.gone);
    if (ks.length > MAX || gs.length > MAX) return false;
    for (const k of ks) {
      const x = r.stars[k];
      if (!ID.test(k) || !plain(x) || !SLUG.test(x.s) || !COLORS.includes(x.c) || !time(x.t) || Object.keys(x).length !== 3) return false;
    }
    for (const k of gs) if (!ID.test(k) || !time(r.gone[k])) return false;
    return Object.keys(r).length === 5;
  }

  /* 同じ代どうしの合体。星は足し合わせ、消した印のある星は消す */
  function merge(a, b) {
    const out = { v: 1, life: a.life, since: Math.min(a.since, b.since), stars: {}, gone: {} };
    for (const r of [a, b]) for (const [k, t] of Object.entries(r.gone)) out.gone[k] = Math.max(out.gone[k] || 0, t);
    for (const r of [a, b]) for (const [k, x] of Object.entries(r.stars)) if (!(k in out.gone)) out.stars[k] = { s: x.s, c: x.c, t: x.t };
    return out;
  }

  /* ほかの代の記録を、いまの代へ入れる（はじめてつなぐ端末の星を 消さずに足すとき） */
  const adopt = (into, from) => merge(into, { ...from, life: into.life, gone: {} });

  /* 置きかえられた代のあとに この端末で押した星だけ、新しい代へ持っていく */
  function carry(cloud, local) {
    const out = merge(cloud, { ...cloud, stars: {}, gone: {} });
    for (const [k, x] of Object.entries(local.stars)) if (x.t > cloud.since && !(k in cloud.gone)) out.stars[k] = { ...x };
    return out;
  }

  const same = (a, b) => {
    if (!a || !b || a.life !== b.life) return false;
    const eq = (x, y) => { const k = Object.keys(x); return k.length === Object.keys(y).length && k.every((i) => i in y); };
    return eq(a.stars, b.stars) && eq(a.gone, b.gone);
  };

  /* 押された順の星（夜空と表紙の回数の もと） */
  const ordered = (r) => Object.entries(r.stars).sort((x, y) => x[1].t - y[1].t || (x[0] < y[0] ? -1 : 1));
  function counts(r) {
    const out = {};
    for (const x of Object.values(r.stars)) {
      const c = out[x.s] || (out[x.s] = { b: 0, r: 0 });
      c[x.c]++;
    }
    return out;
  }
  const sky = (r) => ordered(r).map(([, x]) => x.c);

  function add(r, slug, c, now = Date.now()) {
    const id = newId();
    r.stars[id] = { s: slug, c, t: now };
    return id;
  }
  function remove(r, id, now = Date.now()) {
    if (!(id in r.stars)) return false;
    delete r.stars[id];
    r.gone[id] = now;
    return true;
  }

  /* 前の版の記録（{本:{b,r}} と 押された順の色）を、星1こずつの形にする。押された順はできるだけ保つ */
  function fromOld(old, oldSky, now = Date.now()) {
    const r = fresh(now);
    const left = {};
    for (const [s, c] of Object.entries(plain(old) ? old : {})) {
      if (!SLUG.test(s) || !plain(c)) continue;
      for (const k of COLORS) if (Number.isSafeInteger(c[k]) && c[k] > 0) (left[k] = left[k] || []).push(...Array(Math.min(c[k], 5000)).fill(s));
    }
    const order = [];
    for (const k of Array.isArray(oldSky) ? oldSky : []) if (left[k] && left[k].length) order.push([left[k].shift(), k]);
    const rest = [];
    for (const k of COLORS) for (const s of left[k] || []) rest.push([s, k]);
    const all = [...rest, ...order];
    all.forEach(([s, c], i) => { r.stars[newId()] = { s, c, t: now - (all.length - i) * 1000 }; });
    r.since = all.length ? now - (all.length + 1) * 1000 : now;
    return r;
  }

  g.Stars = { COLORS, MAX, newId, fresh, valid, merge, adopt, carry, same, counts, sky, add, remove, fromOld };
})(typeof window !== "undefined" ? window : globalThis);
