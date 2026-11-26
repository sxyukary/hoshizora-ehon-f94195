/* ほしぞら絵本
   ほんだな（案C: 1冊ずつ大きく・横にすべらせて選ぶ）と、よむ画面。
   設計方針は ../設計図.md を参照 */

const $ = (id) => document.getElementById(id);

/* 「よんだよ」は ふたり分。色で分ける（名前は出さない）。
   b = あおじろい星（カストルの色）、r = あかい星（ポルックスの色） */
const STORE_KEY = "hoshizora.reads";   // { slug: { b: 回数, r: 回数 } }
const SKY_KEY = "hoshizora.sky";       // 押された順の色 ["b","r",...]。夜空の星になる
const SEEN_KEY = "hoshizora.skySeen";  // 夜空で もう見せた星の数（新しい星だけ光らせる）
const COLORS = ["b", "r"];
const COLOR_NAME = { b: "あおじろい ほし", r: "あかい ほし" };
const COLOR_FILE = { b: "blue", r: "red" };
const MAX_ROW = 5;                     // 表紙の星は5こまで並べ、それより多いと 星1つ＋数字
const MAX_SKY = 160;                   // 夜空に並べる星の上限

const el = {
  shelf: $("shelf"), reader: $("reader"), loading: $("loading"),
  rail: $("rail"), shelfDots: $("shelfDots"), reset: $("resetStamps"), sky: $("sky"),
  spread: $("spread"), pic: $("pic"), text: $("text"),
  tapPrev: $("tapPrev"), tapNext: $("tapNext"),
  back: $("back"), pageDots: $("pageDots"), done: $("done"), toast: $("toast"),
};

let manifest = [];
let book = null;      // いま開いている本
let page = 0;         // いま何ページ目（0はじまり）
const cache = new Map();

/* ---------- 「よんだよ」の記録（この端末の中だけに保存） ---------- */
const load = (key, empty) => {
  try { return JSON.parse(localStorage.getItem(key)) || empty; }
  catch { return empty; }
};
const save = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
};
const readCounts = () => load(STORE_KEY, {});

// この本を開いているあいだに押した色（もう一度押すと取り消せる）
let pressed = new Set();

function press(color) {
  const counts = readCounts();
  const c = counts[book.slug] || (counts[book.slug] = { b: 0, r: 0 });
  const sky = load(SKY_KEY, []);
  if (pressed.has(color)) {           // 取り消し：さっき増やした分を戻す
    pressed.delete(color);
    c[color] = Math.max(0, (c[color] || 0) - 1);
    const i = sky.lastIndexOf(color);
    if (i >= 0) sky.splice(i, 1);
    const seen = load(SEEN_KEY, 0);
    if (seen > sky.length) save(SEEN_KEY, sky.length);
  } else {
    pressed.add(color);
    c[color] = (c[color] || 0) + 1;
    sky.push(color);
    showToast(color);
  }
  save(STORE_KEY, counts);
  save(SKY_KEY, sky);
  renderDone();
}

const starImg = (color, cls = "") =>
  `<img class="${cls}" src="assets/star-${COLOR_FILE[color]}.webp" alt="">`;

/* 夜空の星の位置。番号から毎回同じ場所が出るようにする（並びが変わらない） */
function skyPos(i) {
  const r = (n) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  return { x: 3 + r(1) * 94, y: 10 + r(2) * 80, s: r(3) < 0.25 ? 1.5 : r(3) < 0.6 ? 1.15 : 0.85 };
}

function renderSky() {
  const sky = load(SKY_KEY, []).slice(0, MAX_SKY);
  const seen = Math.min(load(SEEN_KEY, 0), sky.length);
  el.sky.querySelector(".stars").innerHTML = sky.map((c, i) => {
    const p = skyPos(i);
    return `<img class="kira${i >= seen ? " new" : ""}" src="assets/kira-${COLOR_FILE[c]}.webp" alt=""
      style="left:${p.x}%;top:${p.y}%;--k:${p.s}">`;
  }).join("");
  el.sky.setAttribute("aria-label", `ふたりの よぞら。ほし ${sky.length}こ`);
  save(SEEN_KEY, sky.length);
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
  updateShelfDots();
}

function renderShelf() {
  const counts = readCounts();
  renderSky();
  el.rail.innerHTML = manifest.map((b) => {
    const title = (b.titleLines && b.titleLines.length ? b.titleLines : [b.title]).join("<br>");
    return `<button class="book" data-slug="${b.slug}" style="--th:${b.theme}">
      <div class="cover">
        <img src="${b.cover}" alt="">
        ${coverStamps(counts[b.slug])}
      </div>
      <div class="meta">
        <div class="bt">${title}</div>
        <div class="bn">${b.pageCount}ページ</div>
      </div>
    </button>`;
  }).join("");

  el.shelfDots.innerHTML = manifest.map((_, i) =>
    `<i class="${i === 0 ? "on" : ""}"></i>`).join("");

  el.rail.querySelectorAll(".book").forEach((btn) => {
    btn.addEventListener("click", () => openBook(btn.dataset.slug));
  });
}

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

    document.documentElement.style.setProperty("--th", book.theme);
    el.pageDots.innerHTML = book.pages.map(() => "<i></i>").join("");

    page = 0;
    pressed = new Set();
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

function closeBook() {
  el.reader.classList.remove("on");
  el.reader.hidden = true;
  el.shelf.classList.add("on");
  renderShelf();          // 星の増加を反映
  updateShelfDots();
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

function showPage(animate = true) {
  const p = book.pages[page];

  el.pic.src = `books/${book.slug}/${p.image}`;
  el.pic.alt = p.alt || "";
  el.text.innerHTML = paragraphsToHtml(p.paragraphs);

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
   子どもにスクロールさせないための仕掛け。 */
function fitText() {
  const t = el.text;
  t.style.removeProperty("--fit");
  let fit = 1;
  while (t.scrollHeight > t.clientHeight + 1 && fit > 0.6) {
    fit -= 0.04;
    t.style.setProperty("--fit", fit.toFixed(2));
  }
}

// 画面の向きが変わったり、窓の大きさが変わったら、もう一度合わせ直す
let fitTimer;
const refit = () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => { if (book) fitText(); }, 120);
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

// 星の記録を消す（おとなのひと用。まちがい防止に2回たずねる）
el.reset.addEventListener("click", () => {
  if (!confirm("読んだ回数の星と、夜空の星を、ぜんぶ消しますか？")) return;
  if (!confirm("本当に消します。よろしいですか？")) return;
  try { [STORE_KEY, SKY_KEY, SEEN_KEY].forEach((k) => localStorage.removeItem(k)); } catch {}
  renderShelf();
  updateShelfDots();
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
  goTo(i) { page = i; showPage(false); },
};

initShelf().then(openFromUrl).catch((err) => {
  el.rail.innerHTML =
    `<p style="color:#fff;padding:20px;text-align:center">絵本を読み込めませんでした。<br><small>${err}</small></p>`;
});
