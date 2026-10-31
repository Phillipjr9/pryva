/**
 * Nothing about *what software is behind this site* should ride along with a
 * response.
 *
 * Two different things leak, and only one of them is ours to fix:
 *
 *   1. **The application banner.** `X-Powered-By: Next.js` names the framework;
 *      `X-Matched-Path` names the internal route a request resolved to. Both are
 *      added by the app, so both are removed here and `poweredByHeader: false`
 *      stops the first one at the source.
 *   2. **The server banner.** A self-hosted Node server sends no `Server` header
 *      at all; a reverse proxy in front of one usually does, often with a version
 *      (`nginx/1.25.3`, `Apache/2.4.58`, `PHP/8.3.12`). A version in a response
 *      header tells an attacker which exploit to try first, and it is free to
 *      remove. On Vercel the platform writes `Server: Vercel` *after* the app
 *      runs, so app code cannot delete it — that needs a proxy in front of the
 *      deployment (Cloudflare, or a reverse proxy). It carries no version, so it
 *      identifies the host, not the exploitable build.
 *
 * This module is the single definition of all of it, because a rule that lives
 * only in a comment gets refactored away. `src/proxy.ts` strips the headers on
 * every response, and `scripts/check-headers.mjs` checks a live URL with the same
 * list — so the claim in the docs can be re-tested rather than believed.
 */

/**
 * Headers that name the stack and have no business reaching a client.
 *
 * Deliberately a closed list: removing arbitrary headers would eventually remove
 * one the browser or a cache depends on. Each entry is here because it either
 * names the software or its version.
 */
export const FRAMEWORK_BANNERS = [
  "x-powered-by", // "Next.js", "Express", "PHP/8.3.12" — the classic banner
  "x-aspnet-version", // "4.0.30319"
  "x-aspnetmvc-version", // "5.2"
  "x-matched-path", // which internal route the request resolved to
  "x-runtime", // request timing, framework-specific
  "x-generator", // "WordPress 6.5", "Drupal 10"
] as const;

/**
 * Does this header value reveal a *version*?
 *
 * `Vercel` and `cloudflare` identify a host with no exploitable detail; a token
 * containing digits — `nginx/1.25.3`, `Apache/2.4.58 (Ubuntu)`,
 * `PHP/8.3.12`, `Next.js 16.4.3` — tells someone which CVE to reach for. The
 * rule is therefore "a digit anywhere in a server banner", which is blunt on
 * purpose: a hostname like `edge-01` would be flagged too, and a banner we do not
 * recognise is exactly when guessing is the wrong move.
 */
export function revealsVersion(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\d/.test(value);
}

export type BannerLeak = {
  header: string;
  value: string;
  /** What it discloses, in the words the runbook uses. */
  why: string;
  /** Whether this app can remove it, or only something in front of it can. */
  fixable: boolean;
};

export type BannerReport = {
  checked: Array<{ url: string; status: number }>;
  leaks: BannerLeak[];
  /** Informational: banners that identify the host but leak no version. */
  notices: BannerLeak[];
  ok: boolean;
};

/** Read a header from a `Headers` object or a plain object, case-insensitively. */
function read(headers: Record<string, string | undefined> | Headers, name: string): string | null {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value != null) return value;
  }
  return null;
}

/**
 * What a response tells a stranger about the stack behind it.
 *
 * `removeable` is false for `Server`, because the only place a Vercel deployment
 * gets that header written is after this code has run. Saying so in the report
 * keeps the docs honest instead of implying a header is gone when it is not.
 */
export function inspectBanners(
  headers: Record<string, string | undefined> | Headers,
  hints: { hostedOnVercel?: boolean } = {},
): { leaks: BannerLeak[]; notices: BannerLeak[] } {
  const leaks: BannerLeak[] = [];
  const notices: BannerLeak[] = [];

  for (const name of FRAMEWORK_BANNERS) {
    const value = read(headers, name);
    if (value == null) continue;
    leaks.push({
      header: name,
      value,
      why: name === "x-matched-path" ? "names the internal route the request resolved to" : "names the framework behind the site",
      fixable: true,
    });
  }

  // The platform writes this after the app has finished, so it is reported but
  // not claimed as fixable here. Locally and self-hosted it is absent entirely.
  const server = read(headers, "server");
  if (server != null) {
    const leak = {
      header: "server",
      value: server,
      why: revealsVersion(server) ? "names the web server *and its version*" : "names the hosting platform",
      fixable: !hints.hostedOnVercel,
    };
    if (revealsVersion(server)) leaks.push(leak);
    else notices.push(leak);
  }

  return { leaks, notices };
}

/** True when a response has nothing to say about the stack behind it. */
export function bannersAreQuiet(headers: Record<string, string | undefined> | Headers): boolean {
  return inspectBanners(headers).leaks.length === 0;
}
