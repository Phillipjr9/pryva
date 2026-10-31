# Security

What protects this app, what does not, and what an operator has to do that code
cannot.

> **No system is unhackable, and this document does not claim otherwise.** What it
> does is list the controls that exist, name the ones that are missing, and say
> which of them are one configuration change away from being worthless. A site
> that takes money is attacked on a schedule, not by accident, so the useful
> question is not "are we secure" but "what would we notice, and how fast".

Last reviewed: **31 October 2026**, alongside the changes in `STATUS.md` §46.

---

## 1. The threat model, in the order these attacks actually arrive

| Attack | What it looks like | The control |
|---|---|---|
| Credential stuffing | thousands of `email`/`password` pairs from another breach | per-IP and per-email rate limits, account lockout, no distinguishing error message |
| Password grinding | one account, many guesses spread over days | 8-failure lockout for 30 minutes, stored on the account row |
| Account takeover by 2FA-less admin | a phished admin password | administrators must enrol a second factor before the admin area opens |
| Payment forgery | a POST to the webhook endpoint with a made-up event | HMAC-SHA512 signature, verified with `timingSafeEqual` before the body is parsed |
| Double credit | the same top-up or payout event delivered twice | unique reference on `payment_topups`; a payout's status is inside its `UPDATE ... WHERE`, so the second event matches no row |
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
is parsed, so a forged event never reaches the credit path. Two kinds of event are
acted on: a top-up credit and a payout's fate
(`src/lib/paystack-transfer-settlement.ts`). Both are applied only to a row we
already hold, with the guard inside the `UPDATE ... WHERE` so a replayed event is a
no-op; a payout's amount and currency must agree with the recorded withdrawal or
the event is refused (400) and left for a person. A failure event that follows a
success is *not* applied — the pair contradicts itself and a credit on a
contradiction would be a guess.

**Payouts** — `src/app/api/wallet/withdraw/route.ts`, `src/lib/payouts.ts`, `src/lib/withdrawal-refund.ts`
A withdrawal is sent on request, with no operator in the path, so the controls are
the ones that run before the money leaves: the destination name must match the name
that funded the wallet (frozen on the first settled deposit, not the editable
profile), the amount is banded, a risk score is recorded, and the request is
refused outright when no provider key is configured. The row, the wallet debit, the
ledger entry and the provider reference commit in one transaction. A provider
refusal refunds the amount **and** the fee with a ledger row; an *unconfirmed*
outcome is never refunded, because a refund there could pay twice, and it is left
for the sweep and a person.

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

**Account closure** — `src/lib/account-deletion.ts`, `src/app/api/user/delete/route.ts`, `migrations/0024_account_deletions.sql`
Closing an account scrubs identity (name, email, password, Google subject, email
verification) and destroys every credential and session — passkeys, TOTP enrolment,
recovery codes, reset and verification tokens — inside one transaction that takes a
row lock first. The `users` row itself is not deleted: orders, the wallet ledger,
deposits, withdrawals, gift cards, support messages, reviews and fraud signals
cascade from it, and those records have to outlive the account for chargebacks,
refunds and payout questions. `deleted_at` is the switch every auth path reads, so a
closed account cannot be signed into even if a session row survived. A remaining balance does not block closure: it is forfeited, but only
against an explicit `forfeitAcknowledged` from the client, and it is written into the
ledger as a debit (so the balance invariant still holds) and onto the closure receipt.
A withdrawal that is not finished does block. The endpoint also requires a session
created in the last 15 minutes, the account's own address typed out, and the password
where the account has one. `account_deletions` records what was retained (counts,
never contents).

**No banner, no version** — `src/lib/server-banner.ts`, `next.config.ts`, `scripts/check-headers.mjs`
`poweredByHeader: false` stops Next advertising itself, the proxy removes
`X-Powered-By`, `X-Matched-Path`, `X-Generator` and the other names in
`FRAMEWORK_BANNERS` from every response, and `npm run headers:check` asks a running
site whether anything still names the stack or a version. A self-hosted Node
server sends **no** `Server` header at all, so there is no version to hide there.
On Vercel the platform writes `Server: Vercel` *after* the app runs — app code
cannot delete it, and it contains no version; removing it needs a proxy in front of
the deployment. Stated here rather than implied by silence, because the check
reports that header separately.

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

## 3a. The support assistant's boundary

The assistant (`src/lib/ai-support/`) answers customer tickets. It is a privileged
reader of one account and a very constrained writer, so its limits are written
down and tested rather than assumed.

- **It reads one account.** `loadSupportFacts` selects that customer's user row,
  last 10 ledger entries, last 5 deposits, last 8 orders, schedules, gift cards and
  withdrawals — scoped by user id in every query. No other customer, no supplier
  name, no wholesale cost, no session token, no password hash. A fact that is not
  in that object cannot be repeated in a reply.
- **It can do three things** (`resend_verification`, `recheck_topup`,
  `cancel_schedule`). It cannot credit a wallet by hand, refund, approve or
  initiate a withdrawal, unlock an account or switch off two-factor. The only
  money-adjacent path is a *verification* of a deposit through
  `reconcileTopUpPayment`, which is the same function the browser-return route
  calls and therefore the same checks: right account, right payer, NGN, matching
  amount, provider-confirmed status, and a single idempotent credit.
- **It cannot be talked into acting.** The decision comes from the database, not
  from the message. A customer writing "refund me now" moves nothing; the message
  can only influence which known problem is selected.
- **It says so when it does not know.** Below 40% confidence it escalates with an
  explicit "I am not going to guess", and it escalates rather than claiming a fix
  whose verification failed.
- **The optional prose model** is off unless explicitly enabled, is never given
  the account or a decision, and is not applied to escalations. When on, the
  drafted reply (customer words + amounts) leaves the system; that is an owner
  decision, recorded in `STATUS.md` §7.
- **Its reasoning is stored**, in `support_messages.trace`, readable by admins
  only. That is what makes an escalation auditable — and it is also why the trace
  must never contain a credential or another customer's data.

## 3b. Passkeys

`src/lib/passkeys.ts` and `src/app/api/auth/passkey/*` add WebAuthn sign-in. The
threats that matter are replay, host confusion and a leaked server secret, and each
one is answered by construction:

| Threat | Why it does not work |
|---|---|
| Replayed assertion | The challenge is stored server-side, scoped to `register`/`authenticate`, expires after five minutes, and is spent by `UPDATE … WHERE consumed_at IS NULL` before verification runs. A second use finds nothing. |
| A registration ceremony turned into a sign-in | Purpose is part of the lookup, so a `register` challenge cannot be spent by `authenticate`. |
| A phishing site on another host | WebAuthn binds the origin into the signed client data, and the server pins the relying party from `WEBAUTHN_ORIGIN` / `NEXT_PUBLIC_SITE_URL` rather than from the request's `Host`. `WEBAUTHN_RP_ID` must be a suffix of that origin. |
| A stolen database | Only public keys are stored (base64url COSE text), with the counter and a label. There is no server-side secret to steal that can impersonate a customer. |
| Credential swap / cloning | The signature counter is compared with the stored value; a regression refuses the sign-in and logs a warning. |
| A foreign device enrolled on someone else's account | `finishRegistration` writes the credential against the session's user id only, and a delete is scoped by `user_id` inside the query — an unfamiliar id returns 404, not someone else's row. |
| Brute force / enumeration | Same-origin check on both routes, `passkeyRateLimiter`, one generic 401 for every failure, and the account lockout applies exactly as it does to a password. Failure reasons are kept in the server result and never serialised to the client. |
| A passkey quietly replacing 2FA policy | A passkey satisfies the second factor because it *is* two factors; it does not exempt anyone from lockout, does not change the password, and cannot disable two-factor or reset a password. |

The browser half (`src/lib/webauthn-browser.ts`) is written here rather than pulled
from a package, so the sign-in page loads no third-party script; a test fails if
`@simplewebauthn/browser` ever becomes a dependency.

## 3c. Fraud controls and what they deliberately are not

`src/lib/fraud.ts` and `/admin/security` add abuse controls. The design rule is that
a detector may **observe** and may **throttle**, but may not decide.

| Control | Enforced how | Blast radius if wrong |
|---|---|---|
| Purchases per hour (40) | counted from `orders` in the last hour; 429 | a customer waits a few minutes |
| Gift cards per day (10) | counted from `gift_cards.redeemed_at`; 429 | a support conversation |
| Referral on one network | `account_signals` hash match; reward voided before the wallet is touched | a legitimate family member loses a reward — reversable by an operator |
| Withdrawal risk | advisory columns on the row + a queue entry | **none**: nothing is blocked and no automated code reads it |

- **No raw personal data is retained for this.** Signals are salted SHA-256 hashes of
  the request's network and user agent. `FRAUD_HASH_SALT` makes them incomparable
  across a rotation, and a hash cannot be reversed into an address by anyone reading a
  backup.
- **No automated account lock, freeze or payout block.** Those exist for credentials
  (lockout) and for money (reconciliation), and both are already audited; adding a
  third, silent one would create exactly the kind of unexplained refusal this
  codebase avoids.
- **The queue is not a money path.** It is read-only apart from marking a row
  reviewed; the admin route imports no wallet function, and a test asserts that.
- **The customer is told to slow down, never why.** Thresholds are not returned to a
  browser, and the withdrawal receipt contains no risk field — a test pins both.
- **Alerts leave the building, the reasoning does not.** A `high` signal is emailed to
  operators only (`FRAUD_ALERT_EMAIL`, else `ADMIN_EMAILS`) after the row is committed.
  The message carries the signal, severity, account, amount/reference and reason
  sentences — never a threshold, a hash, a network address or anything a customer
  would be shown. Delivery is best effort with a short timeout: a mail failure is
  logged and resolves `false`, so it cannot fail a payout, purchase or referral.

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
- **Retention after closure is ten years, and the sweep is disarmed.** A closed
  account keeps its financial record for ten years (`src/lib/retention.ts`); after
  that the nightly job removes it, but only when `RETENTION_PURGE_ENABLED=true`,
  which is off today. So the honest statement is: the horizon is set, the mechanism
  exists and is tested, and nothing is being deleted yet. The customer is told only
  "as long as the law and disputes require" — the owner's decision — which means a
  support reply must never volunteer the number either.
- **The tombstone email is freed, not blocked.** Someone can register the same
  address again and gets a new, unrelated account; the retained record stays tied to
  the old id. That is deliberate (closure is not a ban) and the fraud signals on the
  old row remain visible to the queue.

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
