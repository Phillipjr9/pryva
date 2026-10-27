/**
 * A value that changes whenever the running build changes.
 *
 * Why this exists: an open tab keeps the JavaScript it loaded. After a deploy
 * (or a dev-server restart) that tab can hydrate fresh server markup with stale
 * client code — React reports a hydration mismatch, and worse, a button whose
 * handler lives in the old bundle does nothing at all. That is exactly how the
 * demo login "stopped working" while the server log showed no request.
 *
 * The server renders this id into the page and exposes it at /api/version; the
 * client compares and reloads once if they differ.
 */
const globalForBuild = globalThis as typeof globalThis & { __pryvaBuildId?: string };

function resolveBuildId(): string {
  const fromHost =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.GITHUB_SHA;
  if (fromHost) return fromHost;

  // Local dev: one id per server process, so a restart makes open tabs reload
  // instead of running yesterday's components against today's markup.
  return `dev-${process.pid}-${Math.round(Date.now() / 1000)}`;
}

export const BUILD_ID: string = (globalForBuild.__pryvaBuildId ??= resolveBuildId());

/**
 * Inline, framework-free version check.
 *
 * This runs as plain HTML script, *not* as a React component, for one reason: a
 * stale tab has stale JavaScript, so a React-based guard is missing from exactly
 * the tabs that need it. The HTML, however, is always freshly rendered, so this
 * snippet is current even when every component on the page is a build behind.
 *
 * Fetches /api/version, compares it with the id baked into this page, and reloads
 * once if the tab is older than the server. Two brakes (remembered build + max
 * two reloads per session) stop a bad deploy from looping a tab.
 */
export function staleBuildScript(buildId: string): string {
  return `(function(){try{
var build=${JSON.stringify(buildId)},K="pryva:reloaded-for",C="pryva:version-reloads";
function check(){try{fetch("/api/version",{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(d){
if(!d||!d.build||d.build===build)return;
try{if(sessionStorage.getItem(K)===d.build)return;var n=Number(sessionStorage.getItem(C)||0);if(n>=2)return;
sessionStorage.setItem(K,d.build);sessionStorage.setItem(C,String(n+1));}catch(e){}
window.location.reload();}).catch(function(){});}catch(e){}}
check();
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")check();});
window.addEventListener("pageshow",function(e){if(e.persisted)check();});
}catch(e){}})();`;
}
