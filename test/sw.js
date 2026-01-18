// sw.js
const CACHE = "stampcam-test-shell-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./camera.html",
  "./styles.css",
  "./app.js",
  "./camera.js",
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (!url.pathname.includes("/test/")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch {
      return (await cache.match("./index.html")) || new Response("offline", { status: 503 });
    }
  })());
});
