import { randomBytes } from "node:crypto";

function inlineString(value: string): string {
  // JSON strings still need escaping when embedded inside an HTML script tag.
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** A bridge only for the shared, in-memory Arena demo; never for private accounts. */
export function previewDemoBridgePage(nextPath: string, token: string): Response {
  const nonce = randomBytes(16).toString("base64");
  const script = `(async function () {
  var next = ${inlineString(nextPath)};
  var token = ${inlineString(token)};
  function deadline(promise, ms) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("preview bridge timed out")); }, ms);
    })]);
  }
  try {
    if (!("serviceWorker" in navigator) || !("caches" in window)) throw new Error("preview bridge unavailable");
    await deadline(navigator.serviceWorker.register("/preview-demo-bridge.js", { scope: "/", updateViaCache: "none" }), 8000);
    await deadline(navigator.serviceWorker.ready, 8000);
    if (!navigator.serviceWorker.controller) {
      await deadline(new Promise(function (resolve) {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      }), 5000);
    }
    var controller = navigator.serviceWorker.controller;
    if (!controller) throw new Error("preview bridge not controlling this page");
    await deadline(new Promise(function (resolve, reject) {
      var channel = new MessageChannel();
      channel.port1.onmessage = function (event) {
        channel.port1.close();
        if (event.data && event.data.ok) resolve();
        else reject(new Error("preview bridge could not save the demo session"));
      };
      controller.postMessage({ type: "set-preview-demo-session", token: token }, [channel.port2]);
    }), 5000);
  } catch (_) {
    // Ordinary cookie-based login remains the fallback when the bridge cannot run.
  }
  window.location.replace(next);
})();`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Opening demo</title></head><body style="font-family:system-ui,sans-serif;background:#faf7f1;color:#252025;margin:0;padding:2rem"><main style="max-width:32rem;margin:3rem auto"><h1>Opening the shared demo…</h1><p>Please wait a moment.</p><noscript><p>JavaScript is unavailable. <a href="/dashboard">Continue to the dashboard</a>.</p></noscript></main><script nonce="${nonce}">${script}</script></body></html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; base-uri 'none'`,
      "Referrer-Policy": "no-referrer",
    },
  });
}
