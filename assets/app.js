/* ほしぞら絵本
   ほんだな（1冊ずつ大きく・横にすべらせて選ぶ。季節の とびらで しぼる）と、よむ画面。
   見た目は 案2「まどの むこう」（2026-11-28）。
   設計方針は ../設計図.md を参照 */

const $ = (id) => document.getElementById(id);

/* 「よんだよ」は ふたり分。色で分ける（名前は出さない）。
   b = あおじろい星（カストルの色）、r = あかい星（ポルックスの色）
   記録は 星1こずつ（assets/stars.js）。合言葉を入れると ほかの端末と そろう（sync/worker.js） */
const St = window.Stars;
const REC_KEY = "hoshizora.stars";     // assets/stars.js の記録
const OLD_KEY = "hoshizora.reads";     // 前の版 { slug: { b: 回数, r: 回数 } }（読むだけ。はじめに1回 移す）
const OLD_SKY = "hoshizora.sky";       // 前の版 押された順の色
const SEEN_KEY = "hoshizora.skySeen";  // 夜空で もう見せた星の数（新しい星だけ光らせる）
const SYNC_LS = "hoshizora.sync";      // { on, key, life: クラウドと そろえた代, last: そろえた時刻 }
const COLORS = St.COLORS;
const COLOR_NAME = { b: "あおじろい ほし", r: "あかい ほし" };
const COLOR_FILE = { b: "blue", r: "red" };
const MAX_ROW = 5;                     // 表紙の星は5こまで並べ、それより多いと 星1つ＋数字
const MAX_SKY = 160;                   // 夜空に並べる星の上限

const el = {
  shelf: $("shelf"), reader: $("reader"), loading: $("loading"),
  rail: $("rail"), shelfDots: $("shelfDots"), grownOpen: $("grownOpen"), sky: $("sky"),
  doors: $("doors"), wordmark: $("wordmark"), bgA: $("bgA"), bgB: $("bgB"),
  spread: $("spread"), pic: $("pic"), picBox: $("picBox"), text: $("text"), readerBg: $("readerBg"),
  tapPrev: $("tapPrev"), tapNext: $("tapNext"),
  back: $("back"), pageDots: $("pageDots"), done: $("done"), toast: $("toast"),
};

let manifest = [];
let book = null;      // いま開いている本
let season = seasonNow();   // 本棚で いま開いている季節の とびら
let focusSlug = "";         // 本棚に もどったとき まんなかに置く本

/* 季節の とびら（案B）。季節は manifest.json の season（tools/import_book.py の SEASON） */
const SEASONS = [
  ["haru", "はる", `<svg viewBox="0 0 24 24" aria-hidden="true">${[0, 72, 144, 216, 288].map((r) =>
    `<path transform="rotate(${r} 12 12)" d="M12 11.2C9.3 9.3 8.8 5.6 10.5 3.3L12 4.7l1.5-1.4c1.7 2.3 1.2 6-1.5 7.9z" fill="#f2a7bb"/>`).join("")}<circle cx="12" cy="12" r="1.9" fill="#e9b949"/></svg>`],
  ["natsu", "なつ", `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.8" fill="#f3b73f"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((r) =>
    `<path transform="rotate(${r} 12 12)" d="M12 2v3" stroke="#f3b73f" stroke-width="2" stroke-linecap="round"/>`).join("")}</svg>`],
  ["aki", "あき", `<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(35 12 12)"><path d="M12 2.4C17 5.7 18.2 12 12 18.4 5.8 12 7 5.7 12 2.4z" fill="#e27547"/><path d="M12 4.8v16.8" stroke="#fde3cf" stroke-width="1.2" stroke-linecap="round"/><path d="M12 9.4l2.6-2M12 12.6l3.1-2.4M12 9.4l-2.6-2M12 12.6l-3.1-2.4" stroke="#fde3cf" stroke-width=".9" stroke-linecap="round"/></g></svg>`],
  ["fuyu", "ふゆ", `<svg viewBox="0 0 24 24" fill="none" stroke="#8fb6ea" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">${[0, 60, 120].map((r) =>
    `<g transform="rotate(${r} 12 12)"><path d="M12 2.2v19.6"/><path d="M9.3 4.6 12 7l2.7-2.4M9.3 19.4 12 17l2.7 2.4"/></g>`).join("")}</svg>`],
];
function seasonNow(d = new Date()) {
  const m = d.getMonth() + 1;
  return m === 12 || m <= 2 ? "fuyu" : m <= 5 ? "haru" : m <= 8 ? "natsu" : "aki";
}
/* 絵に描きこまれた紙のふちを切り落とす倍率（trim は tools/trim_edges.py が測った、片側の割合） */
const zoomOf = (trim) => (trim > 0 ? (1 / (1 - 2 * trim)).toFixed(3) : 1);
let page = 0;         // いま何ページ目（0はじまり）
const cache = new Map();

/* ---------- 「よんだよ」の記録 ---------- */
const load = (key, empty) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? empty; }
  catch { return empty; }
};
const save = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
};
function loadRec() {
  const r = load(REC_KEY, null);
  if (St.valid(r)) return r;
  const moved = St.fromOld(load(OLD_KEY, {}), load(OLD_SKY, []));   // 前の版の星を移す（前の記録は消さない）
  save(REC_KEY, moved);
  return moved;
}
const saveRec = (r) => save(REC_KEY, r);

// この本を開いているあいだに押した色と、その星の番号（もう一度押すと取り消せる）
let pressed = new Map();

function press(color) {
  const rec = loadRec();
  if (pressed.has(color)) {           // 取り消し：さっき増やした星を消す
    St.remove(rec, pressed.get(color));
    pressed.delete(color);
    const n = St.sky(rec).length;
    if (load(SEEN_KEY, 0) > n) save(SEEN_KEY, n);
  } else {
    pressed.set(color, St.add(rec, book.slug, color));
    showToast(color);
  }
  saveRec(rec);
  renderDone();
  syncSoon();
}

const starImg = (color, cls = "") =>
  `<img class="${cls}" src="assets/star-${COLOR_FILE[color]}.webp" alt="">`;

/* 夜空の星の位置。番号から毎回同じ場所が出るようにする（並びが変わらない） */
function skyPos(i) {
  const r = (n) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  return { x: 3 + r(1) * 94, y: 10 + r(2) * 80, s: r(3) < 0.25 ? 1.5 : r(3) < 0.6 ? 1.15 : 0.85 };
}

function renderSky(rec = loadRec()) {
  const sky = St.sky(rec).slice(0, MAX_SKY);
  const seen = Math.min(load(SEEN_KEY, 0), sky.length);
  el.sky.querySelector(".stars").innerHTML = sky.map((c, i) => {
    const p = skyPos(i);
    return `<img class="kira${i >= seen ? " new" : ""}" src="assets/kira-${COLOR_FILE[c]}.webp" alt=""
      data-x="${p.x}" data-y="${p.y}" style="left:${p.x}%;top:${p.y}%;--k:${p.s}">`;
  }).join("");
  el.sky.setAttribute("aria-label", `ふたりの よぞら。ほし ${sky.length}こ`);
  save(SEEN_KEY, sky.length);
  layoutSky();
}

/* 夜空の帯を「時計の下の ぼかしより下 〜 本の上」に合わせ、タイトルの文字にかかる星は 横によける */
function layoutSky() {
  const cover = el.rail.querySelector(".book .cover");
  if (!cover || !el.shelf.classList.contains("on")) return;
  const top = el.sky.offsetTop, bottom = cover.getBoundingClientRect().top - 6;
  const h = Math.max(36, bottom - top), w = el.sky.clientWidth;
  el.sky.style.height = h + "px";
  const m = el.wordmark.getBoundingClientRect(), shown = m.width > 0;
  el.sky.querySelectorAll(".kira").forEach((s) => {
    const x = parseFloat(s.dataset.x) / 100 * w, y = top + parseFloat(s.dataset.y) / 100 * h;
    let left = parseFloat(s.dataset.x);
    if (shown && y > m.top - 12 && y < m.bottom + 12 && x > m.left - 16 && x < m.right + 16) {
      // タイトルの左右の近いほうへ。はみ出すときは反対へ
      const toL = (m.left - 20 - (m.right - x) * 0.4) / w * 100, toR = (m.right + 20 + (x - m.left) * 0.4) / w * 100;
      left = x < (m.left + m.right) / 2 ? (toL > 2 ? toL : toR) : (toR < 98 ? toR : toL);
    }
    s.style.left = left + "%";
  });
}

function coverStamps(c) {
  if (!c) return "";
  const rows = COLORS.filter((k) => c[k] > 0).map((k) => {
    const n = c[k];
    const body = n > MAX_ROW
      ? `${starImg(k)}<b>${n}</b>`
      : starImg(k).repeat(n);
    return `<div class="row" aria-label="${COLOR_NAME[k]} ${n}かい">${body}</div>`;
  });
  return rows.length ? `<div class="stamps">${rows.join("")}</div>` : "";
}

/* ---------- ほんだな ---------- */
async function initShelf() {
  const res = await fetch("manifest.json");
  manifest = (await res.json()).books;
  renderShelf();
  el.rail.addEventListener("scroll", updateShelfDots, { passive: true });
}

function shelfBooks() { return manifest.filter((b) => b.season === season); }

function renderShelf() {
  const rec = loadRec(), counts = St.counts(rec), books = shelfBooks();
  el.doors.innerHTML = SEASONS.map(([k, name, icon]) =>
    `<button class="door" data-season="${k}" aria-pressed="${k === season}">${icon}<span>${name}</span></button>`).join("");
  el.rail.innerHTML = books.map((b) => {
    const title = (b.titleLines && b.titleLines.length ? b.titleLines : [b.title]).join("<br>");
    return `<button class="book" data-slug="${b.slug}" style="--th:${b.theme}">
      <div class="cover" style="--z:${zoomOf(b.coverTrim)}">
        <img src="${b.cover}" alt="">
        ${coverStamps(counts[b.slug])}
      </div>
      <div class="bt">${title}</div>
      <div class="bn">${b.pageCount}ページ</div>
    </button>`;
  }).join("");

  el.shelfDots.innerHTML = books.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("");

  el.rail.querySelectorAll(".book").forEach((btn) => {
    btn.addEventListener("click", () => openBook(btn.dataset.slug));
  });
  shelfAt = -1;
  scrollToBook(focusSlug);
  renderSky(rec);
}

el.doors.addEventListener("click", (e) => {
  const d = e.target.closest(".door");
  if (!d || d.dataset.season === season) return;
  season = d.dataset.season; focusSlug = "";
  renderShelf();
});

/* その本を まんなかに（ない・空なら いちばん左） */
function scrollToBook(slug) {
  const card = slug && el.rail.querySelector(`.book[data-slug="${slug}"]`);
  el.rail.scrollLeft = card ? card.offsetLeft + card.offsetWidth / 2 - el.rail.clientWidth / 2 : 0;
  updateShelfDots();
}

/* 星だけ描き直す（本棚の並びと すべらせた位置は そのまま） */
function refreshStars() {
  const rec = loadRec(), counts = St.counts(rec);
  renderSky(rec);
  el.rail.querySelectorAll(".book").forEach((btn) => {
    const cover = btn.querySelector(".cover");
    cover.querySelector(".stamps")?.remove();
    cover.insertAdjacentHTML("beforeend", coverStamps(counts[btn.dataset.slug]));
  });
}

/* うしろの ぼかした絵を、まんなかの本の表紙に（2枚を かさねて ゆっくり入れかえる） */
let shelfAt = -1, bgFront = el.bgA;
function updateShelfDots() {
  const cards = [...el.rail.querySelectorAll(".book")];
  if (!cards.length) return;
  const mid = el.rail.scrollLeft + el.rail.clientWidth / 2;
  let near = 0, best = Infinity;
  cards.forEach((c, i) => {
    const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
    if (d < best) { best = d; near = i; }
  });
  el.shelfDots.querySelectorAll("i").forEach((d, i) =>
    d.classList.toggle("on", i === near));
  if (near === shelfAt) return;
  shelfAt = near;
  const src = cards[near].querySelector("img").getAttribute("src");
  const back = bgFront === el.bgA ? el.bgB : el.bgA;
  back.style.backgroundImage = `url("${src}")`;
  back.classList.add("on"); bgFront.classList.remove("on");
  bgFront = back;
}

/* ---------- 本をひらく ---------- */
async function openBook(slug) {
  el.loading.hidden = false;
  try {
    if (!cache.has(slug)) {
      const res = await fetch(`books/${slug}/book.json`);
      cache.set(slug, await res.json());
    }
    book = cache.get(slug);
    book.slug = slug;
    focusSlug = slug;
    const s = manifest.find((b) => b.slug === slug)?.season;
    if (s && s !== season) { season = s; shelfStale = true; }   // 本棚に もどったら その本の季節を出す

    document.documentElement.style.setProperty("--th", book.theme);
    el.pageDots.innerHTML = book.pages.map(() => "<i></i>").join("");

    page = 0;
    pressed = new Map();
    showPage(false);
    el.shelf.classList.remove("on");
    el.reader.hidden = false;
    el.reader.classList.add("on");
    // 先の数ページを裏で読み込んでおく（めくったときに待たせない）
    preload(1); preload(2);
  } finally {
    el.loading.hidden = true;
  }
}

let shelfStale = false;
function closeBook() {
  el.reader.classList.remove("on");
  el.reader.hidden = true;
  el.shelf.classList.add("on");
  if (shelfStale) { shelfStale = false; renderShelf(); }
  else { refreshStars(); scrollToBook(focusSlug); }   // 星の増加を反映。読んだ本を まんなかに
  syncSoon();
  book = null;
}

/* ---------- ページを表示する ---------- */
function tokenToHtml(tok) {
  // r があるものは、漢字の上にふりがなをふる
  const body = tok.r
    ? `<ruby>${escapeHtml(tok.t)}<rt>${escapeHtml(tok.r)}</rt></ruby>`
    : escapeHtml(tok.t);
  return tok.h ? `<span class="hl">${body}</span>` : body;
}

function paragraphsToHtml(paragraphs) {
  return paragraphs.map((para) =>
    "<p>" + para.map((line) => line.map(tokenToHtml).join("")).join("<br>") + "</p>"
  ).join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hasRuby(paragraphs) {
  return paragraphs.some((para) => para.some((line) => line.some((tok) => tok.r)));
}

function charCount(paragraphs) {
  let n = 0;
  paragraphs.forEach((para) => para.forEach((line) =>
    line.forEach((tok) => { n += tok.t.length; })));
  return n;
}

// その本で いちばん多い 絵の形（横÷縦）
function bookAspect(b) {
  if (b.aspect) return b.aspect;
  const count = new Map();
  b.pages.forEach((p) => {
    if (!p.w || !p.h) return;
    const ar = Math.round((p.w / p.h) * 100) / 100;
    count.set(ar, (count.get(ar) || 0) + 1);
  });
  b.aspect = [...count].sort((x, y) => y[1] - x[1])[0]?.[0] || 1.333;
  return b.aspect;
}

function showPage(animate = true) {
  const p = book.pages[page];

  const src = `books/${book.slug}/${p.image}`;
  el.pic.src = src;
  el.pic.alt = p.alt || "";
  // 絵の枠は 絵そのものの形に。紙のふちは 切り落とす。
  // 枠の形は 1冊で そろえる（形が少しだけ違う絵があっても、めくって枠が動かないように。はみ出すぶんは cover で切る）
  el.picBox.style.setProperty("--ar", bookAspect(book).toFixed(4));
  el.picBox.style.setProperty("--z", zoomOf(p.trim));
  el.readerBg.style.backgroundImage = `url("${src}")`;
  el.text.innerHTML = `<div class="in">${paragraphsToHtml(p.paragraphs)}</div>`;

  // 文章が多いページだけ、文字を少し小さくして画面に収める
  const n = charCount(p.paragraphs);
  el.text.classList.toggle("dense", n > 150 && n <= 220);
  el.text.classList.toggle("denser", n > 220);
  // ふりがなのあるページは、行の間を広げて重ならないようにする
  el.text.classList.toggle("has-ruby", hasRuby(p.paragraphs));
  el.text.scrollTop = 0;

  el.pageDots.querySelectorAll("i").forEach((d, i) =>
    d.classList.toggle("on", i === page));

  // 端では反応させない（暴発させない）
  el.tapPrev.disabled = page === 0;
  el.tapNext.disabled = page === book.pages.length - 1;
  const last = page === book.pages.length - 1;
  el.done.hidden = !last;
  el.pageDots.hidden = last;
  if (last) renderDone();

  fitText();

  if (animate) {
    el.spread.classList.remove("turn");
    void el.spread.offsetWidth;      // アニメーションをやり直させる
    el.spread.classList.add("turn");
  }
  preload(page + 1);
}

/* 文章が枠からはみ出すときは、収まるまで文字を少しずつ小さくする。
   子どもにスクロールさせないための仕掛け。
   絵は 文の量で 動かさない（めくっても 絵の大きさと場所が 変わらないように。2026-11-28 案B） */
function fitText() {
  const t = el.text, over = () => t.scrollHeight > t.clientHeight + 1;
  t.style.removeProperty("--fit");
  let fit = 1;
  while (over() && fit > 0.4) {
    fit -= 0.04;
    t.style.setProperty("--fit", fit.toFixed(2));
  }
}

// 画面の向きが変わったり、窓の大きさが変わったら、もう一度合わせ直す
let fitTimer;
const refit = () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => { if (book) fitText(); else { scrollToBook(focusSlug); layoutSky(); } }, 120);
};
window.addEventListener("resize", refit);
window.addEventListener("orientationchange", refit);
// フォントの読み込みが終わると文字の大きさが変わるので、そこでも合わせ直す
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);

function preload(i) {
  if (!book || i < 0 || i >= book.pages.length) return;
  new Image().src = `books/${book.slug}/${book.pages[i].image}`;
}

function go(step) {
  if (!book) return;
  const next = page + step;
  if (next < 0 || next >= book.pages.length) return;   // 端では何も起きない
  page = next;
  showPage();
}

/* ---------- 操作 ---------- */
el.tapPrev.addEventListener("click", () => go(-1));
el.tapNext.addEventListener("click", () => go(1));
el.back.addEventListener("click", closeBook);

/* さいごのページの 星のボタン。読んだ人が 自分の色を押す。
   ひとりの日は1つ、ふたりの日は2つ。押しても本は閉じない（もうひとりが押せるように） */
function renderDone() {
  el.done.innerHTML = COLORS.map((k) => {
    const on = pressed.has(k);
    return `<button type="button" class="star-btn${on ? " on" : ""}" data-c="${k}"
      aria-pressed="${on}" aria-label="${COLOR_NAME[k]} ${on ? "ついたよ" : "よんだよ"}">
      ${starImg(k)}<span>${on ? "ついたよ" : "よんだよ"}</span></button>`;
  }).join("");
  el.back.classList.toggle("nudge", pressed.size > 0);
}
el.done.addEventListener("click", (e) => {
  const btn = e.target.closest(".star-btn");
  if (btn) press(btn.dataset.c);
});

let toastTimer;
function showToast(color) {
  el.toast.innerHTML = `${starImg(color)}よぞらに ほしが ふえたよ`;
  el.toast.hidden = false;
  el.toast.classList.remove("show"); void el.toast.offsetWidth; el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

// スワイプでもめくれる
let sx = 0, sy = 0, moved = false;
el.reader.addEventListener("touchstart", (e) => {
  const t = e.changedTouches[0];
  sx = t.clientX; sy = t.clientY; moved = false;
}, { passive: true });

el.reader.addEventListener("touchend", (e) => {
  if (moved) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - sx, dy = t.clientY - sy;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    moved = true;
    go(dx < 0 ? 1 : -1);
  }
}, { passive: true });

// PCで読むとき用（矢印キー）
document.addEventListener("keydown", (e) => {
  if (el.reader.hidden) return;
  if (e.key === "ArrowRight" || e.key === " ") go(1);
  if (e.key === "ArrowLeft") go(-1);
  if (e.key === "Escape") closeBook();
});

/* ---------- ほかの端末と そろえる（合言葉の同期） ----------
   同じアドレスの /sync/（sync/worker.js）に、星の記録だけを預ける。合体は assets/stars.js。
   そろえるのは ひらいたとき・星を押したとき・本棚にもどったとき・画面にもどってきたとき。
   つながらないときは 30秒・2分・10分あとに やりなおし、そのあとは次に押すまで待つ */
let sync = { on: false, key: "", life: "", last: 0, ...load(SYNC_LS, {}) };
const saveSync = () => save(SYNC_LS, sync);
const SYNC_RETRY = [30000, 120000, 600000];
let syncState = "", syncBusy = null, syncAgain = null, syncTimer = null, syncFails = 0;
const syncReady = () => sync.on && sync.key.length >= 12;

async function syncCall(method, p, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch("sync/v1/" + p, {
      method, cache: "no-store", signal: ctl.signal,
      headers: { "x-sync-key": sync.key, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  } finally { clearTimeout(t); }
}
const syncWhy = (s) => s === 401 ? "key" : s === 503 || s === 404 ? "closed" : "offline";

/* クラウドの記録と この端末の記録を あわせる。
   同じ代 → 合体／この端末が知っている代のあとで置きかえられた → クラウドに合わせ、そのあと押した星だけ持っていく／
   はじめてつなぐ → この端末の星を クラウドの代に足す */
function syncJoin(local, cloud) {
  if (!cloud) return local;
  if (cloud.life === local.life) return St.merge(local, cloud);
  if (sync.life && local.life === sync.life) return St.carry(cloud, local);
  return St.adopt(cloud, local);
}

async function syncRun() {
  clearTimeout(syncTimer); syncTimer = null;
  syncState = "busy"; showSyncStatus();
  const start = loadRec();
  let got, result;
  try {
    got = await syncCall("GET", "stars");
    if (got.status !== 200) return syncEnd(syncWhy(got.status));
    let cloud = got.data.data;
    for (let i = 0; i < 3; i++) {
      const send = syncJoin(start, cloud);
      if (cloud && St.same(send, cloud)) { result = cloud; break; }
      const r = await syncCall("POST", "stars", { data: send });
      if (r.status === 200) { result = r.data.data; break; }
      if (r.status === 409 && r.data) { cloud = r.data.data; continue; }
      return syncEnd(r.status === 422 ? "full" : syncWhy(r.status));
    }
    if (!result) return syncEnd("offline");
  } catch (e) { console.error("sync", e); return syncEnd("offline"); }
  // とどくまでの あいだに押した星も 落とさない
  const now = loadRec();
  const fin = now.life === result.life ? St.merge(now, result) : now.life === start.life ? syncJoin(now, result) : now;
  if (fin.life !== result.life) return syncEnd("offline");
  const changed = !St.same(fin, now);
  saveRec(fin);
  sync.life = fin.life; sync.last = Date.now(); saveSync();
  if (changed && !el.shelf.hidden && el.shelf.classList.contains("on")) refreshStars();
  syncEnd("ok");
  if (!St.same(fin, result)) syncSoon();
}
function syncEnd(why) {
  syncState = why;
  if (why === "ok") syncFails = 0;
  else if (why === "offline") {
    syncFails++;
    if (syncFails <= SYNC_RETRY.length) syncTimer = setTimeout(syncNow, SYNC_RETRY[syncFails - 1]);
  }
  showSyncStatus();
}
/* いま そろえている途中なら、終わってから もう1回（待つ人には その1回が終わるまでの約束を返す） */
function syncNow() {
  if (!syncReady()) return Promise.resolve();
  if (syncBusy) {
    if (!syncAgain) syncAgain = syncBusy.then(() => { syncAgain = null; return syncNow(); });
    return syncAgain;
  }
  syncBusy = syncRun().finally(() => { syncBusy = null; });
  return syncBusy;
}
let soonTimer = null;
function syncSoon() {
  if (!syncReady() || syncState === "key" || syncState === "closed") return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(syncNow, 1500);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { syncFails = 0; syncNow(); } });
window.addEventListener("online", () => { syncFails = 0; syncNow(); });

/* ---------- おとなのひと（本棚のいちばん下の小さなボタン） ---------- */
const grown = {
  dlg: $("grown"), key: $("syncKey"), save: $("syncSave"), off: $("syncOff"), status: $("syncStatus"),
  restoreBox: $("restoreBox"), day: $("restoreDay"), restore: $("restoreGo"), reset: $("resetStamps"), close: $("grownClose"),
};
function showSyncStatus() {
  if (!grown.dlg.open) return;
  const t = sync.last ? new Date(sync.last).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const msg = !sync.on ? "いまは この端末の中だけに 星を しまっています。"
    : syncState === "busy" ? "そろえています…"
    : syncState === "key" ? "合言葉が ちがいます。もう一度 入れてください。"
    : syncState === "closed" ? "そろえる準備が まだできていません（合言葉の設定が要ります）。"
    : syncState === "full" ? "星が多すぎて そろえられません。"
    : syncState === "offline" ? `つながりません。あとで もう一度 ためします。${t ? `（さいごに そろえたのは ${t}）` : ""}`
    : t ? `ほかの端末と そろっています（${t}）。` : "そろえています…";
  grown.status.textContent = msg;
  grown.off.hidden = !sync.on;
  grown.restoreBox.hidden = !sync.on;
  grown.reset.textContent = sync.on ? "星を ぜんぶ けす（そろえている端末 すべて）" : "星を ぜんぶ けす（この端末）";
}
async function loadDays() {
  grown.day.innerHTML = "";
  if (!sync.on) return;
  try {
    const r = await syncCall("GET", "history");
    if (r.status !== 200) return;
    grown.day.innerHTML = r.data.days.map((d) => {
      const at = new Date(d.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const note = d.day.includes("~") ? "（けす・もどす の直前）" : "";
      return `<option value="${d.day}">${at} 星${d.n}こ${note}</option>`;
    }).join("");
  } catch {}
}
el.grownOpen.addEventListener("click", () => { grown.key.value = sync.key; grown.dlg.showModal(); showSyncStatus(); loadDays(); });
grown.close.addEventListener("click", () => grown.dlg.close());
grown.save.addEventListener("click", async () => {
  const k = grown.key.value.trim();
  if (k.length < 12 || k.length > 64) { grown.status.textContent = "合言葉は 12〜64文字に してください。"; return; }
  if (k !== sync.key) sync.life = "";
  sync.on = true; sync.key = k; saveSync();
  syncFails = 0; syncState = "";
  await syncNow();
  refreshStars(); loadDays();
});
grown.off.addEventListener("click", () => {
  if (!confirm("この端末で そろえるのを やめますか？（星は この端末に のこります）")) return;
  sync = { on: false, key: "", life: "", last: 0 }; saveSync(); syncState = "";
  grown.key.value = ""; showSyncStatus();
});

/* 新しい代に置きかえる（ぜんぶ けす・まえの日に もどす）。そろえているときは クラウドも置きかえる */
async function replaceAll(next) {
  if (!sync.on) { saveRec(next); return true; }
  try {
    await syncNow();
    const r = await syncCall("PUT", "stars", { data: next, from: loadRec().life });
    if (r.status !== 200) { alert("つながらないので できませんでした。あとで もう一度 ためしてください。"); return false; }
    saveRec(r.data.data); sync.life = r.data.data.life; sync.last = Date.now(); saveSync();
    return true;
  } catch { alert("つながらないので できませんでした。あとで もう一度 ためしてください。"); return false; }
}
grown.reset.addEventListener("click", async () => {
  const where = sync.on ? "そろえている端末 すべての" : "この端末の";
  if (!confirm(`${where} 読んだ回数の星と、夜空の星を、ぜんぶ消しますか？`)) return;
  if (!confirm("本当に消します。よろしいですか？" + (sync.on ? "（30日のあいだは「まえの日に もどす」で もどせます）" : ""))) return;
  if (await replaceAll(St.fresh())) { save(SEEN_KEY, 0); refreshStars(); showSyncStatus(); loadDays(); }
});
grown.restore.addEventListener("click", async () => {
  const day = grown.day.value;
  if (!day || !confirm(`${grown.day.selectedOptions[0].textContent} の星に もどしますか？（いまの星は「けす・もどす の直前」として のこります）`)) return;
  try {
    const r = await syncCall("GET", "history/" + day);
    if (r.status !== 200) throw new Error(r.status);
    const next = { ...St.fresh(), stars: r.data.data.stars };
    if (await replaceAll(next)) { refreshStars(); showSyncStatus(); loadDays(); }
  } catch { alert("つながらないので できませんでした。"); }
});

/* ---------- オフラインで読めるようにする ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.update();
    }).catch(() => {});
  });
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

/* URLで直接ひらく（例: #orion や #orion/5）。動作確認と、あとで
   「この絵本を直接ひらく」リンクを作りたくなったとき用。 */
function openFromUrl() {
  const raw = decodeURIComponent(location.hash.slice(1));
  if (!raw) return;
  const [slug, n] = raw.split("/");
  if (!manifest.some((b) => b.slug === slug)) return;
  openBook(slug).then(() => {
    const i = parseInt(n, 10);
    if (Number.isFinite(i) && i >= 1 && i <= book.pages.length) {
      page = i - 1;
      showPage(false);
    }
  });
}

/* 動作確認用の窓口。画面の見た目や動きには影響しない。
   「全ページが画面に収まっているか」を自動でチェックするときに使う。 */
window.hoshizora = {
  get books() { return manifest; },
  get current() { return book; },
  openBook,
  syncNow,
  goTo(i) { page = i; showPage(false); },
};

initShelf().then(() => { openFromUrl(); syncNow(); }).catch((err) => {
  el.rail.innerHTML =
    `<p style="color:#fff;padding:20px;text-align:center">絵本を読み込めませんでした。<br><small>${err}</small></p>`;
});
