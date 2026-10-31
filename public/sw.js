/*
 * Pryva service worker.
 *
 * ## What it is allowed to remember
 *
 * A service worker outlives the page and is shared by every profile on the
 * device, so a careless cache is a data leak, not a performance tweak. This one
 * caches exactly two things:
 *
 *   1. the offline fallback page, which contains no account data;
 *   2. content-hashed build assets under /_next/static/ and the app icons.
 *
 * HTML navigations are network-first and never written to the cache. /api is
 * never touched, on any method. Nothing is served from cache while the network
 * answers, except the immutable, hashed files above.
 *
 * ## What it deliberately does not do
 *
 * No background sync, no push, no offline purchases. A wallet that queues a
 * payment while offline and replays it later is a double-spend risk, not a
 * feature. The app has to be online to move money.
 */

const VERSION = "pryva-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

/** Build output is content-hashed, so a hit is always the right file. */
const HASHED_ASSET = /^\/_next\/static\//;
/** Icons and other public files keep their name across deploys; cache them too. */
const PUBLIC_ASSET = /^\/icons\/.+\.(?:png|svg|webp|ico)$/;
/** Keeps the cache from growing without bound between version bumps. */
const MAX_ENTRIES = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((key) => cache.delete(key)));
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Only a successful, same-origin response is worth keeping; an error page
  // cached under an asset URL would break the app until the next version bump.
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    // The network failed before a response existed. Only here — never for a 4xx
    // or 5xx — fall back to the offline page.
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Account data, payments and auth are never cached or intercepted.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (HASHED_ASSET.test(url.pathname) || PUBLIC_ASSET.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
