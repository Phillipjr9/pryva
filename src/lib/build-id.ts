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
