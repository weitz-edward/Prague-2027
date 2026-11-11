/* Prague 2027 — service worker.
   Keeps the app usable without a connection:
   - the page itself: fresh copy when online, saved copy when not
   - styling libraries, fonts and photos: saved on first use, then served from the device
   Bump SHELL_VERSION whenever index.html changes in a way that must replace the saved copy at once
   (not strictly needed: an online visit always fetches the newest index.html). */
const SHELL_VERSION = "2026-11-11.4";
const SHELL_CACHE = "prague-shell-" + SHELL_VERSION;
const RUNTIME_CACHE = "prague-runtime-v1";
const IMG_CACHE = "prague-img-v1";

const SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest", "./app-icon-192.png", "./app-icon-512.png"];
const CDN_CORS = [
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
  "https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;600;700;900&family=Heebo:wght@300;400;500;600;700;800&display=swap"
];
const CDN_NO_CORS = ["https://cdn.tailwindcss.com"];
const LIVE_DATA_HOSTS = ["api.open-meteo.com", "api.frankfurter.dev", "api.frankfurter.app"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_URLS);
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all([
      ...CDN_CORS.map((u) => fetch(u, { mode: "cors" }).then((r) => r.ok && runtime.put(u, r)).catch(() => {})),
      ...CDN_NO_CORS.map((u) => fetch(u, { mode: "no-cors" }).then((r) => runtime.put(u, r)).catch(() => {}))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("prague-shell-") && n !== SHELL_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isImage(request, url) {
  return request.destination === "image" || /\.(webp|jpe?g|jfif|png|avif|gif|svg)$/i.test(url.pathname) || url.hostname === "commons.wikimedia.org";
}

async function pageResponse(request) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);   // weak signal: don't hang, use the saved copy
    const fresh = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (fresh.ok) shell.put("./index.html", fresh.clone());
    return fresh;
  } catch (e) {
    return (await shell.match("./index.html")) || (await shell.match("./")) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (LIVE_DATA_HOSTS.includes(url.hostname)) return;          // weather / exchange rate: always live (the app keeps its own last-known copy)

  const sameOrigin = url.origin === self.location.origin;
  if (request.mode === "navigate" || (sameOrigin && /\/(index\.html)?$/.test(url.pathname))) {
    event.respondWith(pageResponse(request));
    return;
  }
  if (sameOrigin && /\/sw\.js$/.test(url.pathname)) return;
  event.respondWith(cacheFirst(request, isImage(request, url) ? IMG_CACHE : RUNTIME_CACHE).catch(() => caches.match(request, { ignoreVary: true }).then((r) => r || Response.error())));
});
