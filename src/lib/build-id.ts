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

export const BUILD_GUARD_SCRIPT_ID = "pryva-build-guard";

/**
 * Inline, framework-free staleness check, injected server-side.
 *
 * Two failures look identical to a visitor and need different detection:
 *
 * 1. **Cached HTML.** The document itself is a build behind the server. Visible
 *    by comparing the build id in the HTML with /api/version.
 * 2. **Stale JavaScript.** The document is fresh but the executing bundle is not
 *    — a tab restored from bfcache, or one that kept its modules across a dev
 *    server restart. No build id can reveal this (the HTML is current), so the
 *    only signal is the failure itself: React throwing a hydration mismatch.
 *
 * Both paths reload once, behind two brakes (a remembered target + a hard cap of
 * two reloads per session) so a genuinely broken deploy can't trap a tab.
 *
 * Honest limit: this cannot rescue the tab that is *already* stale — it has the
 * old JavaScript, so it has the old copy of this script. It guarantees that once
 * a tab has loaded a build containing this guard, later drift heals itself.
 */
export function staleBuildScript(buildId: string): string {
  return `(function(){try{
var build=${JSON.stringify(buildId)},K="pryva:reloaded-for",C="pryva:reloads";
var last="";
function reloadOnce(reason){
  // Fail SAFE, not open: if sessionStorage is unavailable (partitioned iframes,
  // storage-blocked browsers) the brakes cannot be recorded, so we must not
  // reload at all. Doing otherwise produced a reload loop — dozens of
  // /api/version calls a second — which is how this bug was found.
  try{
    if(sessionStorage.getItem(K)===reason)return;
    if(Number(sessionStorage.getItem(C)||0)>=2)return;
    sessionStorage.setItem(K,reason);
    sessionStorage.setItem(C,String(Number(sessionStorage.getItem(C)||0)+1));
  }catch(e){return;}
  window.location.reload();
}
function check(){
  var now=Date.now();
  if(now-last<5000)return;
  last=now;
  try{fetch("/api/version",{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(d){
    if(!d||!d.build||d.build===build)return;
    reloadOnce(d.build);
  }).catch(function(){});}catch(e){}
}
check();
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")check();});
window.addEventListener("pageshow",function(e){if(e.persisted)check();});
window.addEventListener("error",function(e){
  var m=(e&&(e.message||(e.error&&e.error.message)))||"";
  if(/hydration|did not match|Minified React error #(418|423|425)/i.test(m))reloadOnce("hydration");
});
}catch(e){}})();`;
}
