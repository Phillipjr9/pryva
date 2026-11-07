# Bot attack: what I found and what I changed

Repo: `Phillipjr9/pryva` · Vercel project `pryva` · PR #108
Date: 2026-11-07

---

## First: your challenge *is* configured

I checked the live Vercel project rather than assuming from the code.

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ✅ set (production)
- `TURNSTILE_SECRET_KEY` ✅ set (production)
- Both were added **18 seconds before** the current production deploy was
  created, and that deploy was built from the Turnstile commit (`3c724d9`).

So the signup form is genuinely challenged in production. That matters, because
it means the signups are coming in through a different door — not that the
protection is broken.

> ⚠️ The one way this could still be false: `NEXT_PUBLIC_*` is inlined into the
> browser bundle **at build time**. If the deploy currently serving your domain
> was built before those variables existed, the page renders no widget while the
> server keeps reading the secret at runtime — "configured" in the dashboard,
> protecting nothing. Confirm at **`/admin/security` → Signup protection**; I
> made it say so explicitly ("this build shipped without…" = redeploy, not
> re-enter the key). If in doubt, just redeploy once.

---

## The real hole: Google signup

`src/app/api/auth/google/callback/route.ts` created an account that was:

- **already email-verified** (`emailVerifiedAt: new Date()`),
- **already mailed** — receipt, welcome, and an operator alert to your inbox,
- **already logged in** (session issued),

…behind **no Turnstile challenge and no rate limit whatsoever**.

Once the password form was challenged, this was the cheapest account factory on
the site. `email_verified` from Google proves *the address*, not *the person* —
and verified Google identities are a traded commodity. A script with a stock of
them never touches your protected form.

This is almost certainly where your signups are still coming from after #107.

### The subtle trap I hit while fixing it

A token cannot simply be appended to the Google start link. `redirect_uri` is
built as `${publicOrigin}/api/auth/google/callback` — the bare origin — so
Google returns the browser with only `code` and `state`, **dropping any
parameter you appended**. The obvious fix silently breaks every new Google
signup. The token is bound in a short-lived `HttpOnly` cookie instead, which
also ties the proof to the browser that solved it.

---

## "Lots of requests to my backend"

These authenticated routes had **no throttle at all**:

| route | what it costs |
|---|---|
| `GET /api/search` | three leading-wildcard `ILIKE` scans across three tables. **Cannot use an index.** This is the most expensive read an ordinary account can ask for — and it's what a search box fires per keystroke. |
| `GET /api/orders/list` | the obvious thing to poll |
| `GET /api/wallet/banks` | the **only** authenticated read that calls Paystack with your secret key |

The bank route was the worst of the three. Its cache is per-instance, and Vercel
runs several instances — so every cold start meant one *real Paystack request
per caller*. An attacker wasn't just hitting your backend; your backend was
amplifying their traffic into your payment provider.

Also unthrottled in a way that costs money: **every successful signup sends a
real verification email through Resend.** The per-IP signup limit bounded it,
but the "resend verification" endpoint minted mail outside signup entirely —
provider quota and sender-domain reputation.

### One thing I checked and it's fine

Per-IP limiting reads `X-Forwarded-For`. That is only safe if the host
*overwrites* it. [Vercel does](https://vercel.com/docs/headers/request-headers)
— explicitly, "to prevent IP spoofing" — so your limits hold there. I added a
note to `SECURITY.txt` because that assumption is host-specific and would be
false on a proxy that appends instead.

I also verified the diagnostics endpoints are shut (`DIAGNOSTICS_SECRET` is
empty, and the auth check refuses an empty secret), and that the airtime /
digital / proxies / subscriptions purchase routes fail closed.

---

## What changed (PR #108)

| Area | Change |
|---|---|
| Google callback | Turnstile verified **before** the insert, inside the create branch only — returning customers are never asked. |
| Google callback | Per-connection limit (20 / 15 min) **before** the Google exchange; fails closed if the counter is unreadable. |
| Google start | Moves the solved token into a short-lived `HttpOnly` cookie. |
| Signup card | Google button is inert until the challenge is solved, and carries the token. Both refusals have plain-English copy. |
| Search / orders / banks | Per-account budgets → `429` + `Retry-After`, or `503` if the store is down (never a silent allowance). |
| Bank directory | Concurrent fetches collapse into one in-flight promise. |
| Verification email | Its own send ceiling, checked after every refusal that costs nothing. |
| Detection | **New:** counts accounts per hour from the database, posts one line to `ALERT_WEBHOOK_URL` past threshold, max once/day, count only — no visitor data. Never blocks the signup. |
| Admin | `/admin/security` distinguishes "misconfigured" from "built before the key existed". |

### On the spike alert

Nothing counted signups **in aggregate**. The fraud queue scores each signup
individually — but a script whose addresses pass the heuristics is
unremarkable row by row, and only obvious as a wave. That's exactly the failure
you experienced: you noticed it, the system didn't.

It counts from the database, not process memory, because each serverless
instance would otherwise only see its own share of the attack and stay under
the threshold.

---

## What you must do

1. **Redeploy after merging** — `NEXT_PUBLIC_*` is baked in at build time.
2. **Verify** `/admin/security` shows the challenge green, and that a test Google
   signup still works (it should now require the widget).
3. **Set `ALERT_WEBHOOK_URL`** if you haven't — that's what makes the spike
   alert reachable. Slack/Discord webhooks both work; no account needed.
4. **Add one Vercel Firewall rate-limit rule** — see below. This is the single
   highest-value action available to you right now, and it needs no code.

## The one rule that stops this at the edge

I checked your plan and corrected an earlier claim of mine: **Vercel WAF,
custom rules and rate limiting are available on Hobby**, not just Pro. The
Hobby *limits* are the real constraint — about **3 custom rules**, and only
**1 rate-limit rule**.

So spend that one rule where it hurts the attacker most:

| Field | Value |
|---|---|
| Path | starts with `/api/auth/` |
| Counting key | IP (the only key on Hobby besides JA4) |
| Window | 60 s |
| Limit | 10 requests |
| Action when exceeded | **challenge** (not deny) |

Why `challenge` and not `deny`: a JS challenge passes real people and stops
scripts, so a shared carrier NAT or an office IP doesn't lock out a genuine
customer. Why `/api/auth/`: that single rule covers signup, login, password
reset, verification and **the Google callback** — exactly the surface bots use
to make accounts. Your in-app limits then work on what still gets through.

Start it in **Log** mode for an hour if you want to see the baseline first;
Firewall changes propagate globally in ~300ms with no redeploy, and roll back
instantly.

For deeper volumetric protection, Cloudflare in front of the domain gives you
real WAF rulesets and bot scoring that Vercel reserves for Enterprise.

## A note on preview deployments

I verified this rather than assuming it, because your build command skips
`db:migrate` on previews and the code swaps in an in-memory database whenever
`DATABASE_URL` is absent:

- Every `PG*` / `AWS_*` variable is scoped to **production only**.
- `isPreviewDatabase()` returns true when neither `DATABASE_URL` nor a
  complete IAM set is present.

So previews run the in-memory shim and **cannot touch your production data**.
That is the correct setup — keep it that way. Do not add `DATABASE_URL` to the
Preview environment to "make previews realistic"; that would point every PR,
including ones from forks and this agent, at your live customer table.

Also worth knowing: **Turnstile is off on previews**, by design (both keys are
production-scoped). That means you cannot exercise the challenge on a preview
URL — test it on production after merging.

## Verification status

**Build verified on Vercel**, not just locally: the PR branch deploys and
reaches `READY` (~48 s) at
`pryva-git-arena-17a0ce43-pryva-codehaven.vercel.app`.

Two deployments before it were **blocked** — `COMMIT_AUTHOR_REQUIRED`. My
commits were authored as `Arena Agent <agent@arena.ai>`, which Vercel cannot map
to a GitHub account, so no preview was built at all. Re-authored to the repo's
own identity; that is the cause, not a code problem. Worth remembering if a
future agent branch silently shows no deployment.

- `npm run typecheck` — clean
- `eslint` — clean
- `npm test` — **2308 passing**, 27 failing across 14 files. I confirmed against
  the untouched baseline commit (`git stash`) that **all 27 fail identically
  without my changes** — they're unrelated (migration fixtures, supplier
  secrecy, layout snapshots). My changes introduce **zero** new failures.
