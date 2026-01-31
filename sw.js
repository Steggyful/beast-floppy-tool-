const CACHE = "beast-floppy-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./sw.js",
  "./assets/ramp.png",
  "./assets/closed-box.png",
  "./assets/open-box.png",
  "./assets/v.png",
  "./assets/x.png",
  "./assets/d-wings.png",
  "./assets/adidas.png",
  "./assets/d-v.png",
  "./assets/d-slant.png",
  "./assets/ninja.png",
  "./assets/t-wings.png",
  "./assets/v-trap.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});