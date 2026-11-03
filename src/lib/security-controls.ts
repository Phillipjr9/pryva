import "server-only";

/**
 * What the security page is allowed to claim.
 *
 * The panel this feeds used to be eight rows of `enabled={true}` written by hand in
 * the client component, so it said "Active" whatever the code did. Five of those
 * eight are detections living in `lib/anti-reverse-engineering.ts`, reachable only
 * through `lib/protection.ts`, and nothing in the app imports that hook -- so those
 * detectors have never run in a customer's browser, `/api/security/report` has never
 * been called by the app, and the violation tiles on the same page can only read zero.
 *
 * The rule is the one the coverage page uses: a control counts as enforced only where
 * a request path runs it. `source` names that path so the claim can be checked rather
 * than believed, and `src/test/security-controls.test.ts` fails if the hook is ever
 * mounted -- which is the moment the `not_running` rows below stop being true.
 */
export type SecurityControlState = "enforced" | "not_running";

export type SecurityControl = {
  id: string;
  label: string;
  /** What the owner is told the control does. */
  description: string;
  state: SecurityControlState;
  /** Where the enforcement lives, or where the unused code sits. */
  source: string;
};

export const SECURITY_CONTROLS: readonly SecurityControl[] = [
  {
    id: "rate_limiting",
    label: "Rate limiting",
    description: "Purchases, auth, exports and withdrawals each ask a limiter before they do anything.",
    state: "enforced",
    source: "src/lib/rate-limit.ts",
  },
  {
    id: "velocity",
    label: "Purchase and gift-card velocity",
    description: "Hour and day ceilings on orders and redemptions, with a breach recorded as an event.",
    state: "enforced",
    source: "src/lib/fraud.ts",
  },
  {
    id: "withdrawal_risk",
    label: "Withdrawal risk assessment",
    description: "Every payout is scored for shared networks and velocity; a high-risk one waits for a person.",
    state: "enforced",
    source: "src/app/api/wallet/withdraw/route.ts",
  },
  {
    id: "network_signals",
    label: "Shared-network detection",
    description: "A salted hash of the signup address and browser string links accounts using one network.",
    state: "enforced",
    source: "src/lib/fraud.ts",
  },
  {
    id: "frame_blocking",
    label: "Frame embedding blocked",
    description: "Responses carry X-Frame-Options and a CSP frame-ancestors rule, so the shop cannot be framed.",
    state: "enforced",
    source: "src/proxy.ts",
  },
  {
    id: "header_hardening",
    label: "Response header hardening",
    description: "HSTS, nosniff, referrer policy, and no framework version or banner in the response.",
    state: "enforced",
    source: "src/proxy.ts",
  },
  {
    id: "devtools_detection",
    label: "DevTools detection",
    description: "Would report a customer opening the browser console. Written, but no page installs it.",
    state: "not_running",
    source: "src/lib/protection.ts",
  },
  {
    id: "debugger_detection",
    label: "Debugger detection",
    description: "Would report an attached debugger. Same situation: implemented, never installed.",
    state: "not_running",
    source: "src/lib/protection.ts",
  },
  {
    id: "injection_detection",
    label: "Code injection detection",
    description: "Would report tampered page code. Implemented, never installed.",
    state: "not_running",
    source: "src/lib/protection.ts",
  },
  {
    id: "iframe_detection",
    label: "Running-in-iframe detection",
    description: "Would report the shop being framed. The header rule above is what actually stops it.",
    state: "not_running",
    source: "src/lib/protection.ts",
  },
  {
    id: "scraping_detection",
    label: "Automated-access detection",
    description: "Would report click patterns that look scripted. Implemented, never installed.",
    state: "not_running",
    source: "src/lib/protection.ts",
  },
  {
    id: "honeypot",
    label: "Honeypot traps",
    description: "Would report a script reading analysis-only code. Implemented, never installed.",
    state: "not_running",
    source: "src/lib/anti-reverse-engineering.ts",
  },
  {
    id: "browser_fingerprinting",
    label: "Browser fingerprinting",
    description: "A canvas and feature fingerprint exists in this file and nothing calls it; the network signal above is what runs.",
    state: "not_running",
    source: "src/lib/security.ts",
  },
];
