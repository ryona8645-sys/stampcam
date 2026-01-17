const CACHE = "surveycam-v1";
const ASSETS = [
  "./",                 // /app/ 自体
  "../index.html",
  "./app.js",
  "./db.js",
  "./export.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  // 作業中に更新を強制しない（固まり要因を避ける）
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // このサイト内だけ処理
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    const res = await fetch(e.request);
    const c = await caches.open(CACHE);
    c.put(e.request, res.clone());
    return res;
  })());
});

