/**
 * Content-Security-Policy for the app.
 *
 * ## What this buys, and what it does not
 *
 * The policy names every origin the browser may load a script, style, font or
 * image from. New exfiltration paths — a compromised dependency, an injected
 * `<script src>` from a supplier's error page, a tracking pixel — have to be
 * added here to work, which is exactly the review this app wants.
 *
 * It does **not** make inline script injection harmless: `script-src` keeps
 * `'unsafe-inline'` because Next.js renders its own bootstrap inline, the home
 * page emits JSON-LD, and `BuildGuard` installs a version check before hydration.
 * A nonce-based policy would force every page to render dynamically and would
 * still need those hand-written scripts to carry the nonce, so it is a separate
 * job, not a header swap. Any user-supplied HTML is therefore still only safe
 * because React escapes it — this header is defence in depth, not a substitute.
 *
 * ## Why some values look generous
 *
 * - `style-src 'unsafe-inline'` — Tailwind and React both emit inline styles.
 * - `img-src https://images.pexels.com` — the marketing photographs.
 * - `img-src https://www.google.com` — Google serves the published favicons for
 *   destination-site entries in the Email OTP catalogue; no remote host is
 *   chosen from the supplier data.
 * - nothing for fonts: they are self-hosted from `@fontsource` packages and
 *   served from `/_next/static`, so `font-src 'self'` is enough. Google's
 *   style and font hosts were removed with the `<link>` tags that needed them.
 * - `frame-ancestors *` (preview only) — the isolated in-memory demo must stay
 *   embeddable in the Arena viewer, which is also why `X-Frame-Options` is
 *   omitted there. A real deployment keeps `'self'`.
 * - `ws:`/`wss:` and `'unsafe-eval'` in development only, for the dev server's
 *   hot reload. They are absent from a production policy, and a test pins that.
 * - `challenges.cloudflare.com` **only when the signup CAPTCHA is configured**.
 *   Turnstile is a script plus a nested iframe, so the default `frame-src 'none'`
 *   would silently break it: the widget would never appear, and with the widget
 *   absent no visitor could produce a token. A deployment with no widget key
 *   keeps `frame-src 'none'`, and a test pins both halves of that.
 */

export type ContentSecurityPolicyOptions = {
  /** The request is the in-memory preview running inside the Arena viewer. */
  embeddedPreview?: boolean;
  /** The process is a development server (hot reload needs eval + websockets). */
  development?: boolean;
  /**
   * A Turnstile site key is configured, so the signup page loads Cloudflare's
   * challenge. Off by default: the origin is only opened for deployments that
   * actually render the widget.
   */
  turnstile?: boolean;
};

/** The single origin Turnstile needs for its script, its iframe and its beacon. */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export const CONTENT_SECURITY_POLICY_HEADER = "Content-Security-Policy";

export function contentSecurityPolicy(options: ContentSecurityPolicyOptions = {}): string {
  const { embeddedPreview = false, development = false, turnstile = false } = options;
  const challenge = turnstile ? [TURNSTILE_ORIGIN] : [];

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", [embeddedPreview ? "*" : "'self'"]],
    ["form-action", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...challenge, ...(development ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["font-src", ["'self'", "data:"]],
    ["img-src", ["'self'", "data:", "blob:", "https://images.pexels.com", "https://www.google.com"]],
    ["connect-src", ["'self'", ...challenge, ...(development ? ["ws:", "wss:"] : [])]],
    ["media-src", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", turnstile ? [TURNSTILE_ORIGIN] : ["'none'"]],
  ];

  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** True when the host is a preview sandbox, which the viewer embeds in a frame. */
export function isEmbeddedPreviewHost(host: string): boolean {
  return /(?:^|\.)e2b\.app(?::\d+)?$/i.test(host);
}
