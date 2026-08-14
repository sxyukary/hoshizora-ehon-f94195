/* ほしぞら絵本 — オフラインで読めるようにする仕組み
   ・アプリの骨組み（画面・並び）は最初にまとめて保存する
   ・絵本の中身は、一度読んだものが自動で保存され、次からネットなしで開ける */

const VERSION = "v1";
const SHELL = `hoshizora-shell-${VERSION}`;
const BOOKS = `hoshizora-books-${VERSION}`;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./assets/app.css",
  "./assets/app.js",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./app.webmanifest",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== BOOKS).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // フォントなど外部は素通し

  const isBook = url.pathname.includes("/books/");

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(isBook ? BOOKS : SHELL).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
