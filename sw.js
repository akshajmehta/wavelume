// Offline cache for the app shell. Bump VERSION whenever you deploy changes.
const VERSION = "wavelume-v3";
const SHELL = ["./", "index.html", "legal.html", "config.js", "app.js", "backend.js", "manifest.webmanifest",
               "icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon-64.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // accounts & payments always go to the network
  // network first (so updates arrive), cache as fallback (so it opens offline)
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
