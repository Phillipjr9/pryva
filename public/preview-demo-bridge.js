/*
 * Arena's in-memory preview gateway can drop Cookie request headers. This
 * opt-in worker carries only the temporary, public demo session to same-origin
 * requests. The server accepts this header only for the shared demo user on the
 * current sandbox's preview host, never for persistent deployments or accounts.
 * No responses or private account sessions are cached.
 */
const CACHE_NAME = "pryva-preview-demo-session-v1";
const SESSION_KEY = new URL("/__pryva_preview_demo_session__", self.location.origin).href;
const HEADER = "X-Pryva-Preview-Session";

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type !== "set-preview-demo-session") return;
  const token = event.data.token;
  const reply = event.ports[0];
  if (!reply || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    reply?.postMessage({ ok: false });
    return;
  }
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(SESSION_KEY, new Response(token, { headers: { "Cache-Control": "no-store" } }));
      reply.postMessage({ ok: true });
    } catch {
      reply.postMessage({ ok: false });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Reissuing a navigational POST from a worker changes its Origin/Fetch
  // Metadata to this origin. Never intercept it: native form submissions must
  // reach the server with their original cross-site security metadata intact.
  if (request.mode === "navigate" && request.method !== "GET") return;
  if (url.origin !== self.location.origin || url.pathname.startsWith("/_next/") ||
      url.pathname.startsWith("/images/") || url.pathname.startsWith("/api/auth/google") ||
      url.pathname === "/preview-demo-bridge.js") return;

  event.respondWith((async () => {
    let cache;
    let token;
    try {
      cache = await caches.open(CACHE_NAME);
      const stored = await cache.match(SESSION_KEY);
      token = stored && await stored.text();
    } catch {
      return fetch(request);
    }
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return fetch(request);

    const headers = new Headers(request.headers);
    headers.set(HEADER, token);
    // Browsers do not allow constructing a new Request with mode "navigate".
    const forwarded = new Request(request, {
      headers,
      ...(request.mode === "navigate" ? { mode: "same-origin" } : {}),
    });
    // Do not retry a failed fetch: it might be a mutation already processed.
    const response = await fetch(forwarded);
    if (url.pathname === "/api/auth/logout" && request.method === "POST" && response.ok) {
      try { await cache.delete(SESSION_KEY); } catch { /* session is already revoked server-side */ }
    }
    return response;
  })());
});
