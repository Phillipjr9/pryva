import { ShieldCheck } from "@/components/icons";

import { StatusBadge } from "@/components/admin/AdminUi";
import { isTurnstileConfigured, turnstileBuildGap, turnstileSiteKey } from "@/lib/platform/turnstile";

/**
 * Whether signup is actually defended, stated plainly.
 *
 * The bot challenge is enforced only when both Turnstile keys are present, so
 * "we shipped a CAPTCHA" and "signup is protected" are different claims. This
 * card is the difference between them: an operator can see at a glance whether
 * the widget is live, and a half-configured deployment — a site key with no
 * secret, which renders a challenge the server never checks — is called out as
 * the misconfiguration it is rather than shown as green.
 */
export function SignupProtection() {
  const configured = isTurnstileConfigured();
  const siteKeyOnly = !configured && Boolean(turnstileSiteKey());
  // A build made before the site key existed renders no widget, and rebuilding
  // is the only fix. Reported separately from "configured", because the tokens
  // variable being present in the dashboard is not evidence the deployed page
  // ever drew the challenge.
  const buildGap = turnstileBuildGap();

  const challengeDetail = siteKeyOnly
    ? "A site key is set but TURNSTILE_SECRET_KEY is missing, so tokens are not being checked. Add the secret key."
    : buildGap
      ? buildGap
      : configured
        ? "Every signup must pass Cloudflare Turnstile — password form and Google signup alike. Refused and expired tokens are rejected."
        : "Not configured. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to require a challenge.";

  const rows: Array<{ label: string; status: string; tone: string; detail: string }> = [
    {
      label: "Bot challenge (Turnstile)",
      status: configured ? "active" : siteKeyOnly ? "misconfigured" : "off",
      tone: configured ? (buildGap ? "pending" : "verified") : siteKeyOnly ? "failed" : "pending",
      detail: challengeDetail,
    },
    {
      label: "Hidden honeypot field",
      status: "active",
      tone: "verified",
      detail: "Always on. A signup that fills the invisible field is refused before an account is created.",
    },
    {
      label: "Google signup",
      status: configured ? "challenged" : "signup limit only",
      tone: configured ? "verified" : "pending",
      detail: configured
        ? "A new Google account must present a Turnstile token, and the return leg is limited per connection. Existing customers signing in are never asked."
        : "Creating an account with Google skips the challenge while Turnstile is unconfigured; only the per-connection return limit applies.",
    },
    {
      label: "New-customer email alert",
      status: "verified only",
      tone: "verified",
      detail:
        "Sent when an address is confirmed, or on a Google signup. Unverified signups no longer email this inbox.",
    },
  ];

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-white p-5 sm:p-6" aria-labelledby="signup-protection-title">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lav-50 text-lav-700">
          <ShieldCheck width={20} height={20} className="h-5 w-5 shrink-0" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="signup-protection-title" className="text-lg font-semibold text-ink">Signup protection</h2>
          <p className="mt-1 text-sm text-ink-2">What stands between an automated script and a new account.</p>
        </div>
      </div>
      <ul className="mt-5 grid gap-3 md:grid-cols-2" aria-label="Current signup defences and their configuration state">
        {rows.map((row) => (
          <li key={row.label} className="min-w-0 rounded-xl border border-line bg-cream p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{row.label}</h3>
              <StatusBadge status={row.tone} label={row.status} />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{row.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
