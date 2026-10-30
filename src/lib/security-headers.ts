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
 * - nothing for fonts: they are self-hosted from `@fontsource` packages and
 *   served from `/_next/static`, so `font-src 'self'` is enough. Google's
 *   style and font hosts were removed with the `<link>` tags that needed them.
 * - `frame-ancestors *` (preview only) — the isolated in-memory demo must stay
 *   embeddable in the Arena viewer, which is also why `X-Frame-Options` is
 *   omitted there. A real deployment keeps `'self'`.
 * - `ws:`/`wss:` and `'unsafe-eval'` in development only, for the dev server's
 *   hot reload. They are absent from a production policy, and a test pins that.
 */

export type ContentSecurityPolicyOptions = {
  /** The request is the in-memory preview running inside the Arena viewer. */
  embeddedPreview?: boolean;
  /** The process is a development server (hot reload needs eval + websockets). */
  development?: boolean;
};

export const CONTENT_SECURITY_POLICY_HEADER = "Content-Security-Policy";

export function contentSecurityPolicy(options: ContentSecurityPolicyOptions = {}): string {
  const { embeddedPreview = false, development = false } = options;

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", [embeddedPreview ? "*" : "'self'"]],
    ["form-action", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["font-src", ["'self'", "data:"]],
    ["img-src", ["'self'", "data:", "blob:", "https://images.pexels.com"]],
    ["connect-src", ["'self'", ...(development ? ["ws:", "wss:"] : [])]],
    ["media-src", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
  ];

  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** True when the host is a preview sandbox, which the viewer embeds in a frame. */
export function isEmbeddedPreviewHost(host: string): boolean {
  return /(?:^|\.)e2b\.app(?::\d+)?$/i.test(host);
}
