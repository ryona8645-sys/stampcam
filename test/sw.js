// sw.js
const CACHE = "stampcam-test-shell-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

// アプリシェル優先。API系は無いのでシンプル。
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // test配下のみ制御（他は触らない）
  if (!url.pathname.includes("/test/")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    // ネット優先で取って、取れたらキャッシュ（CDNも入る）
    try {
      const res = await fetch(req);
      // opaqueでもOK、キャッシュしておく（オフライン時の再現性UP）
      cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch {
      // 最後にルート返し
      return (await cache.match("./index.html")) || new Response("offline", { status: 503 });
    }
  })());
});
