# Security

What protects this app, what does not, and what an operator has to do that code
cannot.

> **No system is unhackable, and this document does not claim otherwise.** What it
> does is list the controls that exist, name the ones that are missing, and say
> which of them are one configuration change away from being worthless. A site
> that takes money is attacked on a schedule, not by accident, so the useful
> question is not "are we secure" but "what would we notice, and how fast".

Last reviewed: **30 October 2026**, alongside the changes in `STATUS.md` §23.

---

## 1. The threat model, in the order these attacks actually arrive

| Attack | What it looks like | The control |
|---|---|---|
| Credential stuffing | thousands of `email`/`password` pairs from another breach | per-IP and per-email rate limits, account lockout, no distinguishing error message |
| Password grinding | one account, many guesses spread over days | 8-failure lockout for 30 minutes, stored on the account row |
| Account takeover by 2FA-less admin | a phished admin password | administrators must enrol a second factor before the admin area opens |
| Payment forgery | a POST to the webhook endpoint with a made-up event | HMAC-SHA512 signature, verified with `timingSafeEqual` before the body is parsed |
| Double credit | the same top-up event delivered twice | unique reference on `payment_topups`, idempotent apply |
| Double spend | two purchases racing the same balance | balance decrement and ledger insert in one transaction, conditional update |
| Refund abuse | "nothing arrived", claimed repeatedly | refunds require the delivery outcome; auto-refunds pause until both ends confirm |
| Privilege escalation | a customer reaching `/admin` or an admin API | `ADMIN_EMAILS` **plus** verified email, checked server-side on every page and API |
| XSS / clickjacking / data exfiltration | injected script, framed page, third-party asset | CSP with no wildcards, `frame-ancestors`, `X-Frame-Options`, no third-party fonts or scripts |
| Infrastructure compromise | a leaked env var or a database dump | TOTP secrets encrypted at rest, password scrypt with per-user salt, secrets never in the repo |
| Supply chain | a malicious or vulnerable transitive package | `npm audit --omit=dev --audit-level=high` in CI, pinned `overrides` for known advisories |

## 2. What is implemented, and where

**Sign-in and sessions** — `src/lib/auth.ts`, `src/app/api/auth/*`
scrypt hashes with a per-user salt; `timingSafeEqual` for verification; session
cookies `httpOnly`, `Secure` on TLS, `SameSite=Lax` (`None`+`Partitioned` only for
the embedded preview); sessions listed and revocable per device; a password reset
deletes every session and releases an account lockout.

**Second factor** — `src/lib/two-factor.ts`, `src/lib/admin-two-factor.ts`
TOTP (RFC 6238 vectors in `src/test/totp.test.ts`), secrets encrypted with
AES-256-GCM under `TWO_FACTOR_KEY`, single-use recovery codes, replay rejection
per time step, and a password-correct sign-in yields a short-lived challenge
rather than a session. **Administrators must enrol**; `ADMIN_2FA_REQUIRED=false`
is the documented recovery hatch and nothing else.

**Lockout and rate limits** — `src/lib/account-lockout.ts`, `src/lib/rate-limit.ts`
8 consecutive wrong passwords lock the account for 30 minutes, atomically in one
`UPDATE`, cleared by a successful sign-in or a completed reset. Rate-limit buckets
are shared through PostgreSQL in production (not per-process), and a store failure
is a **503**, never a silent fallback to counting in memory.

**Payment webhook** — `src/lib/paystack-webhook.ts`, `src/app/api/webhooks/payment/route.ts`
HMAC-SHA512 over the raw body, compared with `timingSafeEqual` before the payload
is parsed, so a forged event never reaches the credit path.

**Money movement** — `src/lib/wallet.ts`, `src/lib/payment-integrity.ts`, routes
Every debit is a conditional `UPDATE ... WHERE balance >= amount` inside a
transaction with its ledger row; purchases carry a per-user idempotency key, so a
retried request replays instead of buying twice; ambiguous supplier outcomes go to
`/admin/reconciliation` rather than being guessed; unavailable products fail closed
with an actionable `503` and never debit.

**Admin surface** — `src/lib/admin-auth.ts`, `src/app/admin/*`
`ADMIN_EMAILS` matched only on a **verified** address; admin API calls require the
same origin header as a form; every privileged mutation writes to
`admin_audit_log` with who, what, when and the row's before/after where it matters;
the admin area is read-mostly by design (reconciliation actions live on the page
that owns them).

**Browser surface** — `src/lib/security-headers.ts`, `src/proxy.ts`
CSP without wildcards (`style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`
after the fonts were self-hosted, `img-src` limited to this origin and the Pexels
host), HSTS with preload, `nosniff`, `Referrer-Policy: origin-when-cross-origin`,
`Permissions-Policy` denying camera/microphone/geolocation, and a policy that a
test compares against `next.config.ts` so the two cannot drift.

**Data handling** — `src/lib/disposable-domains.ts`, `src/lib/sanitize.ts`
Temporary inboxes cannot create accounts (the receipts and resets would die with
the inbox); all SQL goes through Drizzle with bound parameters — the one raw
`.execute(sql\`\`)` in the purchase path passes a **parameter**, not a string;
JSON-LD is escaped so it cannot close its own `<script>` block.

**Detection** — `src/lib/daily-reconciliation.ts`, `src/app/admin/audit`
A nightly close recomputes each day's money from the tables that recorded it and
verifies the ledger invariant per account (`previous ± amount = balance_after`,
and the last row equals `users.wallet_balance`). A break marks the day
`attention` and lists the accounts with the difference. This is the control that
catches what a report cannot: a double debit, a credit without its ledger row, a
manual `UPDATE` that moved a balance and left the history behind.

**Recovery** — `RUNBOOK.md` §8a, `scripts/backup-db.mjs`
Verified logical snapshots (SHA-256 per table, checked before anything is pruned
or restored), a restore that orders tables by foreign key, refuses to run without
`--confirm-restore`, and refuses to touch the live database. The provider's PITR
is the other copy; see the operator checklist below.

## 3. What this pass changed

| Finding | Severity | Action |
|---|---|---|
| `zod < 4.6.6` reachable through `@vercel/functions → @vercel/oidc → @vercel/cli-config` (GHSA-mrhx-c7xc-m3w5, memory exhaustion) | high (transitive) | pinned with an `overrides` entry; `npm audit --omit=dev` now reports **0 vulnerabilities**, and CI fails on a high advisory |
| **Administrators were not required to have 2FA** while being able to approve withdrawals, issue refunds and read every ledger | high | `src/lib/admin-two-factor.ts`; enforced on admin pages *and* admin APIs, with a recovery hatch and an explanation on the security page |
| Accounts could be created from throwaway inboxes, guaranteeing undiscoverable lockouts and no way to reset | medium | signup refuses ~150 disposable domains (`src/lib/disposable-domains.ts`) |
| Repeated wrong passwords only hit in-memory/window counters, so a slow attack could grind forever | medium | account lockout (8 failures / 30 minutes), stored on the account |
| No CI gate on dependency advisories | medium | `npm audit --omit=dev --audit-level=high` added to `ci.yml` |
| Terms of service predated 2FA, lockout, reviews, gift cards and the switched-off products | low (legal) | rewritten (`src/app/(site)/terms/page.tsx`) |

## 4. Known gaps — stated, not hidden

- **No edge bot defence.** Rate limits are in the app. A credential-stuffing
  botnet spread across thousands of IPs will get its per-IP budget everywhere it
  appears; only the per-account lockout slows it. Turn on the platform firewall /
  WAF and a login challenge if this becomes real.
- **Password hashing cost is fixed at Node's default scrypt parameters**
  (N=16384, r=8, p=1). Raising them needs a rehash-on-successful-login path;
  not done, and worth doing before the user table is large.
- **CSP still allows `'unsafe-inline'` for scripts** because React, the JSON-LD
  blocks and the stale-bundle guard emit inline script. A nonce-based policy
  forces every page dynamic — a project, not a header swap.
- **No independent penetration test and no bug bounty.** Everything above was
  reviewed by reading this codebase, not by an attacker with time.
- **Email authentication is not in this repository.** SPF, DKIM and DMARC for the
  sending domain are DNS records: without them, password-reset mail can be spoofed
  by someone else. See the checklist.
- **Single operator, no maker-checker.** One administrator can approve a
  withdrawal alone. At higher volume, a second approval on payouts is the next
  control worth adding.
- **`ADMIN_2FA_REQUIRED=false` is a real hole** if it is left set. Treat it as an
  incident to undo, not a setting.
- **Preview deployments may share the production database** (see
  `migrations/README.md`). Until they are isolated, a preview has production
  data behind it.

## 5. The operator checklist (code cannot do these)

1. **`TWO_FACTOR_KEY`** set in production (32+ chars, stored in the secret
   manager). Without it, 2FA cannot be enrolled and the admin rule is skipped.
2. **`ADMIN_EMAILS`** contains only addresses whose owner has enrolled 2FA, and
   those accounts have verified emails.
3. **Provider backups / PITR enabled**, retention checked, and the restore drill
   in `RUNBOOK.md` §8a run once — into a throwaway database.
4. **`npm run db:backup` on a schedule**, with the archive copied off the machine
   (object storage in a different account from the database).
5. **SPF, DKIM and DMARC** published for the sending domain.
6. **Platform firewall / WAF** on, with a rule for repeated failed logins.
7. **Preview deployments isolated** from the production database.
8. **Secrets rotated** on staff change and after any suspected leak; rotating
   `TWO_FACTOR_KEY` locks every enrolled account out of its second step, so plan
   it with the recovery procedure in the runbook.
9. **`CRON_SECRET` set**, and the nightly job confirmed to have run (a missing
   `reconciliation_runs` row for yesterday is the signal).

## 6. Reporting a vulnerability

Email or message through <https://pryva.ng/contact> with as much detail as you
can, and **do not** test against a live account that is not yours, run automated
scanners against the site, or attempt to extract other customers' data. A report
that stops at "this looks wrong, here is how to reproduce" is worth more than one
that proved it on someone's wallet. `/.well-known/security.txt` points here.
