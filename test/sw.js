const CACHE_NAME = "phototool-test-v1";
const ASSETS = [
  "/test/",
  "/test/index.html",
  "/test/styles.css",
  "/test/app.js",
  "/test/db.js",
  "/test/zip.js",
  "/test/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    // skipWaiting() しない = 作業中に急に切り替わりにくい
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // GETだけキャッシュ
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // 成功だけキャッシュ
      if (res.ok && new URL(req.url).origin === location.origin) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      // オフラインで未キャッシュなら落とす
      return cached || new Response("Offline", { status: 503 });
    }
  })());
});

