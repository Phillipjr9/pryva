# PRYVA — MASTER PLAN & MEMORY

> **What this file is:** the single source of truth for everything you've asked for, checked against the
> code that is *actually* in this repository. Read this first in any new session; update it after every task.
> Copy it freely. Nothing here is dropped — if something is impossible or not mine to decide, it stays on the
> list with a note.
>
> **Last updated:** 2026-10-27 (main merged; money paths unified; marketplace shipped)
> **Branch:** `arena/045f0b51-pryva` (merged up to `main` @ `5153fd4`)
> **Repo audit method:** every status below was verified by reading files in the checkout — not from memory,
> not from the earlier chat log.

---

## 0. HOW WE WORK (rules I follow)

1. You send requirements (any length, typos fine). I **do not start coding**.
2. I convert them into numbered items below, one item per deliverable.
3. I check each item against the real codebase and set a status.
4. I show you the plan. You correct / confirm. **Then** I build — top to bottom, one item at a time.
5. After each item: update this file, append to the change log, commit on this branch.
6. Secrets never go in chat (Paystack/AccsZone/VTpass keys go in `.env` yourself).

**Status legend:** ✅ Done & verified · 🟡 Partial · ⬜ Not started · ❓ Needs your decision · 🚫 Blocked (missing key/access) · 🗑 Dropped by you

---

## 1. RAW REQUEST LOG (what you actually asked, in order)

| # | Your request (condensed) | Where it lives in the plan |
|---|---|---|
| R1 | Add all categories from accszone.com + integrate its API so users can buy everything there | **#1–#8** |
| R2 | Homepage should show what we have; highlight Facebook & Instagram | **#9** |
| R3 | Don't show third-party names anywhere (AccsZone *and* the OTP provider) — users must not know suppliers | **#10** |
| R4 | Audit: what's left to do | **§5** |
| R5 | Pricing: can't buy at $1 and sell at $1 — need a profitable model | **#11** |
| R6 | Automatic exchange rate (no daily manual updates) + wallet deposits via **Paystack** (you first said "haystack", corrected to Paystack) | **#12, #13** |
| R7 | You offered to send Paystack test keys → I declined; keys go in `.env` only | ✔ rule 6 |
| R8 | "Tackle all" audit items + add referrals | **#14, #15** |
| R9 | Use your raw email template file (Veyra design) and improve it | **#16** |
| R10 | Demo login broken — click sign in, stay on login page | **#17** |
| R11 | Run localhost so you can log in and see | **#17** |
| R12 | Can't see Arena preview → asked for a video or public URL | **#42** |
| R13 | Add terms & conditions "and others" | **#18** |
| R14 | Thorough check of the whole system → "implement all" (53-item audit) | **§2 Tier 3** |
| R15 | Look at github.com/morluto/rea and use it to defend against hackers / reverse engineering | **#19, §6** |
| R16 | Rebuild the logo icon, generate options to choose from (you picked option 1) | **#20** |
| R17 | Email templates must use your design + branding | **#16** |
| R18 | Show samples of the images in email templates / "change illustrations without any background" | **#21** |
| R19 | Can we build for iOS + Play Store → you chose **Option A: PWA** | **#22** |
| R20 | What else does the site need (senior-dev view) | **§2 Tier 3** |
| R21 | Skip real email provider (waiting on domain) and **no KYC** — implement the rest | **#23** |
| R22 | Implement all + **users must buy airtime from their wallet balance** | **#24** |
| R23 | Every feature needs its own category, not all in one place | **#25** |
| R24 | MTN/Airtel/Glo/9mobile need their real logos | **#26** |
| R25 | All other features need their own real logo icons (not generic SVG) | **#27** |
| R26 | Generate the rest of the platform logos | **#28** |
| R27 | Security hardening so the site isn't reverse-engineered or hacked | **#19** |
| R28 | Add more to the admin portal | **#29** |
| R29 | You can't judge without preview → what's missing, implement all | **#30** |
| R30 | Users must be able to withdraw wallet balance to their bank via Paystack | **#31** |
| R31 | Make sure payments and balances work with no glitch (anti-scam) | **#32, §4 (P0 bugs)** |
| R32 | OTP timing + refunds when code doesn't arrive; same for all products | **#33** |
| R33 | Check payment animation flow, confetti, redirect back after payment | **#34** |
| R34 | What else to add → implement all (data plans, analytics, dark mode, ⌘K, exports, gift cards, bulk, scheduled, tests) | **#35–#40** |
| R35 | Explain gift cards in detail | **#36** |
| R36 | Every new feature needs real logo icons | **#27** |
| R37 | Auto-check and generate missing icons yourself — no choosing | **#27** |
| R38 | (Language slip — I replied in Chinese; corrected to English) | ✔ |
| R39 | Landing page: show services/products clearly + real smiling woman on her phone, plain gradient | **#41** |
| R40 | Update Terms for the new features | **#18** |
| R41 | Gift cards: own category + **non-refundable** | **#37** |
| R42 | Explain how the payment animation flow works end-to-end | **#43** |

---

## 2. THE PLAN / BACKLOG

### 🔴 TIER 1 — Critical (money & security). Do these first.

| # | Item | Status | Evidence / what's actually left |
|---|------|--------|--------------------------------|
| **0** | **The app didn't compile** | ✅ | `tsc --noEmit` had **113 errors across 58 files** and `next build` failed — the merged PR #2/#3 shipped against helpers that don't exist (`fulfillPlan`, `cancelUpstream`, `FleexaError`, `checkFleexaSms`…), a mock DB missing 6 tables, `cookies()` called synchronously, and `db` typed as `any`. All fixed: typecheck **0 errors**, `next build` **passes**, 12 test files / 89 tests **pass**. |
| **1** | **Paystack webhook no longer mints money** | ✅ | Signature verified against the raw body (fails closed without a secret; constant-time compare). Only `charge.success` credits, and only against a matching `payment_topups` row — status change, credit and ledger row commit together. Unifying pass: a second credit path introduced while this branch was open was removed, so a payment confirmed by both the webhook and the browser callback credits **once** (`lib/topups.ts`). |
| **2** | **Top-up verification endpoint** | ✅ | `POST /api/wallet/topup/verify` asks Paystack, checks currency and that the payer email matches the signed-in user, then completes the top-up through the same `completeTopUp()` the webhook uses. `TopUpReturn` on `/dashboard/wallet` reads Paystack's `trxref`/`reference` params and refreshes the balance. |
| **3** | **Admin APIs locked down** | ✅ | Every `/api/admin/*` handler goes through `authorizeAdminApi()` (`lib/admin-auth.ts`): 401 anonymous, 403 non-admin, 403 cross-origin mutation. The demo identity can never be an admin, and admin emails come from `ADMIN_EMAILS` only. |
| **4** | **Every balance change goes through `debitWallet`/`creditWallet`** | ✅ | `orders/purchase`, `wallet/withdraw`, `digital/purchase`, `airtime/purchase` and `orders/bulk` all debit atomically (balance guard in the SQL `WHERE`) and refund on failure. |
| **5** | **Rate-limit auth & payment endpoints** | ✅ | `lib/rate-limit.ts` + `lib/auth-rate-limit.ts`: login **5 / 15 min per account** and **30 / 15 min per IP**, signup **10 / hour per IP**, all returning `429` + `Retry-After`; the budget is cleared on a successful sign-in. Purchase routes keep their own buckets. In-process counters — move to Redis if the app ever runs more than one instance. |
| **6** | **Security headers / CSP** | 🟡 | Headers were already shipping from `src/proxy.ts` (HSTS, nosniff, Referrer-Policy, Permissions-Policy, preview-aware X-Frame-Options) — the earlier note in this plan was wrong. This pass also removed a wildcard `Access-Control-Allow-Origin: *` from every `/api/*` response, forced `Cache-Control: no-store` on the API and turned off `x-powered-by`. ⬜ **CSP still open** — needs a browser harness before shipping, see the reason in `next.config.ts`. |

### 🟠 TIER 2 — The accounts marketplace (your R1, R2, R5, R6, R10)

| # | Item | Status | What's left |
|---|------|--------|-------------|
| **7** | Marketplace API client (categories, subcategories, listings, listing detail, purchase, orders, balance, promo) | ✅ | `src/lib/accszone.ts` — 20s timeouts, typed errors carrying `code`/`status`/`retryAfter`/`requestId`, 30-minute cache on categories, honours the 30 req/min supplier cap. **Untested against the live API** (no key in this sandbox) — first call must be read-only. |
| **8** | DB support for marketplace orders + migration | ✅ | `orders.accounts` (JSON array of credentials) + `orders_provider_request_idx`; `migrations/005_add_marketplace_accounts.sql`. |
| **9** | `/accounts` browse flow: categories → subcategories → search/sort → paginated grid → quantity + promo → credential delivery | ✅ | `src/app/(site)/accounts/page.tsx` + `AccountsBrowser.tsx`; `/api/accounts/{categories,listings,purchase,promo}`. Prices are always computed server-side; the client never sends a price. |
| **10** | Marketplace in nav / homepage; **Facebook + Instagram featured** | 🟡 | ✅ `Accounts` in the header nav, `Digital accounts` first in the footer service column, `/accounts` in the sitemap-able route list. ⬜ dedicated FB/IG showcase section on the homepage. |
| **11** | Profitable pricing engine | ✅ | `src/lib/marketplace-pricing.ts` — 30% base markup, category premiums (FB/IG +15, X/TikTok +10, email +5), volume tiers 5/10/25 → 5/8/10%, ₦200 minimum profit floor, ₦50 rounding, promo pass-through that never breaks the floor. **8 tests in `src/test/marketplace-pricing.test.ts`.** |
| **12** | Automatic USD→NGN rate with cache + fallbacks | ✅ | `src/lib/exchange-rate.ts` — env pin → 1h cache → open.er-api.com → exchangerate-api → `USD_NGN_FALLBACK` (1600). |
| **13** | Hide supplier names everywhere | ✅ | All user-facing mentions removed (auth layout, how-it-works, homepage ×3, service template, footer "Powered by Fleexa", order badges, and the dashboard provider/balance banner is gone entirely). Supplier names remain only in backend code and comments. |

### 🟡 TIER 3 — Platform features you asked for

| # | Item | Status | Notes |
|---|------|--------|-------|
| **14** | Paystack wallet top-up (init → pay → verify → credit) | 🟡 | Init exists; **verify + credit broken** (see #1, #2). |
| **15** | Wallet withdrawal to bank (user request → admin approval → Paystack transfer → webhook) | 🟡 | API + `withdrawals` table + migration 004 + `paystack.ts` transfers exist; the withdrawal screen is now **mounted** on `/dashboard/wallet` (it was orphaned before), the debit is atomic, and `transfer.success/failed` webhooks settle or refund. **Missing:** admin role gate on the page itself is done, but no `admin/withdrawals/[id]/process` single-item route. |
| **16** | Payment integrity (atomic, row-locked, idempotent, audited) | 🟡 | `lib/payment-integrity.ts` + `wallet.ts` helpers exist. **Missing:** admin `/admin/payment-audit` view, and adoption by airtime (#4). |
| **17** | OTP / product timeouts + automatic refunds | 🟡 | `lib/service-timeouts.ts`, `lib/auto-refund.ts` exist. **Missing:** the cron route that calls them (only `cron/scheduled-orders` exists) + admin failed-orders page. |
| **18** | Demo login works | ✅ | Three demo routes (`auth/demo`, `demo-login`, `demo-web`) + mock-DB persistence fix. Verified routes exist. |
| **19** | Referral program (codes, link, 5% reward, dashboard) | ⬜ | Zero referral code/tables/routes/pages. |
| **20** | Wishlist / saved listings | ⬜ | Nothing. |
| **21** | Product reviews & ratings | ⬜ | Nothing. |
| **22** | Coupons / discount codes | ⬜ | Nothing. |
| **23** | Support ticket system (beyond contact form) | 🟡 | `/dashboard/support` lists `contact_messages` only; no tickets, threads, priorities. |
| **24** | Email service wiring (6 templates already written) | 🟡 **deferred by you** | `lib/email-templates.ts` has welcome / order / top-up / gift card / refund / password-reset templates **with hero images**. No `lib/email.ts` sender, not wired to signup or purchases. You said: waiting on domain. |
| **25** | Email hero illustrations (transparent, brand gradient) | ✅ | `public/images/email/hero-{welcome,order,password,refund,wallet,gift}.jpg` all present. |
| **26** | SMS (Termii) + WhatsApp notifications | ⬜ | Nothing. |
| **27** | Two-factor authentication (TOTP) | ⬜ | `dashboard/security` shows **three "Coming Soon"** cards. |
| **28** | Data export (GDPR/NDPR) | 🟡 | `api/user/export` exists (JSON of user/orders/txns/gift cards/schedules). No UI button in settings. |
| **29** | Legal pages | 🟡 | ✅ `/terms` (incl. gift cards **non-refundable**, 9 services), ✅ `/privacy`. ⬜ `/refund-policy`, ⬜ `/cookie-policy`, ⬜ refund section covering airtime/gift cards/bulk/scheduled in detail. |
| **30** | Admin portal | 🟡 | ✅ `/admin/dashboard`, `/admin/analytics`, `/admin/security`, `/admin/withdrawals`. ⬜ user management, ⬜ audit logs, ⬜ finance, ⬜ payment audit, ⬜ failed orders. No admin role gate (#3). |
| **31** | Data plans / bundles | ✅ | `/dashboard/data`, `api/airtime/plans`, VTpass-based `lib/airtime.ts`. |
| **32** | Airtime purchase **from wallet balance** | 🟡 | Works (`api/airtime/purchase` debits balance) but bypasses the safe wallet helpers (#4). |
| **33** | Bulk orders with volume discounts | ✅ | `/dashboard/bulk-orders`, `api/orders/bulk`, `lib/bulk-orders.ts` (+ tests). |
| **34** | Scheduled purchases (daily/weekly/monthly) | ✅ | `/dashboard/scheduled`, `api/scheduled-orders`, `cron/scheduled-orders`, `lib/scheduled-orders.ts`. |
| **35** | Gift cards: buy / redeem / check / history | ✅ | `lib/gift-cards.ts`, 4 API routes, dashboard manager, `migration/001`, `gift-card` email template. |
| **36** | Gift cards: **non-refundable** + own category | 🟡 | ✅ Backend guard `refundGiftCard()` throws, ✅ Terms say non-refundable, ✅ it is a top-level nav item. ⬜ no explicit "non-refundable" warning box in the purchase UI. |
| **37** | Gift card explainer (how it works, use cases, economics) | ⬜ | You asked; no doc written yet. |

### 🟢 TIER 4 — Experience, operations, polish

| # | Item | Status | Notes |
|---|------|--------|-------|
| **38** | Landing page: real smiling woman on her phone, subtle gradient, clear services | 🟡 | ✅ Hero uses a **real Pexels photo** ("young woman smiling while using her smartphone", `lib/photos.ts`). ⬜ messaging doesn't clearly present all 7 offerings (numbers, eSIM, proxies, email OTP, accounts, airtime, data). |
| **39** | Per-feature real logo icons (PNG, brand gradient) — not generic SVG | 🟡 | ✅ `public/images/services/*` (13), categories (4), brand logo. ⬜ dashboard sidebar still uses **generic `components/icons.tsx` SVGs** (Grid/Wallet/Receipt/Sparkle/Chat). ⬜ no `public/icons/` feature set, ⬜ no provider logos (MTN/Airtel/Glo/9mobile), ⬜ no platform logos (FB/IG/X/TikTok…). |
| **40** | Animation & celebration on payment success | ✅ | `components/ui/{Confetti,PaymentLoading,PaymentSuccess}.tsx`, wired into `TopUpForm` and `PlanPurchase`. ⬜ no "redirecting to Paystack" state; success doesn't auto-refresh balance. |
| **41** | Dark mode + ⌘K command palette | ✅ | `components/theme/*` and `components/command/CommandPalette.tsx` (mounted in `DashboardShell`). |
| **42** | PWA (installable, offline, icons) | ⬜ | No `manifest.json`, `sw.js`, `offline.html`, no PWA meta, `public/` only holds images + logo. |
| **43** | Analytics (GA4 / Web Vitals) | ⬜ | Nothing. |
| **44** | Automated tests that can actually run | ✅ | Vitest installed + `vitest.config.mts` + `npm test`. **22 files / 156 tests pass**, including pricing, webhook-signature, admin-authorization and withdrawal-security suites. |
| **45** | Security suite: rate limiting, validation, anti-RE, sanitisation | 🟡 | ✅ `rate-limit`, `validation`, `security`, `protection`, `anti-reverse-engineering`, `sanitize`, `logger`, `errors`, `proxy` (middleware), ✅ signed webhook, ✅ admin authz, ✅ constant-time signature compare. ⬜ no `audit.ts` (audit trail), ⬜ no bot detection, ⬜ no CSP (#6). |
| **46** | Docs: README, RUNBOOK, .env.example, payment-flow doc | 🟡 | ✅ `PLAN.md`, ✅ `.env.example` (all keys documented incl. FX + markup). ⬜ README, ⬜ RUNBOOK, ⬜ payment-flow doc. |
| **47** | CI/CD, Dockerfile, migrations hygiene | ⬜ | No `.github/`, no Dockerfile. 5 SQL migrations vs 11 tables → still drift. |
| **48** | Preview / public URL for you to actually see the app | 🚫 | Blocked in this sandbox: tunnel tools (localtunnel/cloudflared/ngrok) can't reach the network, and the Arena preview panel didn't render. I can start the server here; still needs your side or a deploy (Vercel) to view. |

**Tally:** ✅ 22 done · 🟡 14 partial · ⬜ 11 not started · 🚫 1 blocked · ❓ 1 open (Q5).

---

## 3. WHAT ALREADY EXISTS (verified inventory)

**Stack** — Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Drizzle ORM + Postgres (mock DB fallback when `DATABASE_URL` is unset) · `canvas-confetti` · `simple-icons` · `pg`.

**Database (12 tables)** — `users`, `sessions`, `orders` (now with an `accounts` credential store), `wallet_transactions`, `contact_messages`, `gift_cards`, `scheduled_orders`, `notifications`, `security_violations`, `withdrawals`, `bank_accounts`.
Migrations: `001_add_gift_cards`, `002_add_scheduled_orders`, `003_add_security_violations`, `004_add_withdrawals`, `005_create_payment_topups`, `006_add_marketplace_accounts`.

**Public site (18 pages)** — Home, About, Blog, Contact, Digital Services, Email OTP, eSIM, FAQ, Help, How it works, **Accounts (marketplace)**, Pricing, Privacy, Proxies, Status, Terms, Testimonials, Virtual Numbers.

**Auth** — login, signup, logout, Google OAuth (start + callback), 3 demo flows, sessions, password change, profile, account delete, data export.
⚠️ No password reset, no email verification, no 2FA.

**Dashboard** — Overview, Wallet, Orders, Data Plans, Gift Cards, Bulk Orders, Scheduled, Support, Security, Settings, Notifications, Digital, plus order detail with live code sync.

**Admin** — Dashboard, Analytics, Security, Withdrawals. ⚠️ No role checks.

**API** — 59 route handlers, now including `/api/accounts/{categories,listings,purchase,promo}` (neutral URLs) and `/api/wallet/topup/verify`.

**Libraries (~5.2k lines + additions)** — catalog, email-templates (6), anti-reverse-engineering, digital-services, security, payment-integrity, protection, paystack (init/verify/transfers/banks/webhook-signature), auth, fleexa, gift-cards, service-timeouts, auto-refund, scheduled-orders, airtime, bulk-orders, wallet, validation, rate-limit, sanitize, logger, errors, cache, net, google, format, utils.

**UI kit (22)** — Accordion, Alert, Badge, Button, Card, Checkbox, Confetti, DataTable, Dropdown, FaqAccordion, Input, Loading, Modal, PaymentLoading, PaymentSuccess, Reveal, Select, Skeleton, Tabs, Textarea, Toast, Tooltip.
Plus theme provider/toggle, command palette, site header/footer/nav, auth forms, brand logo, purchase flow.

**Tests** — 22 files / 156 assertions, runnable via `npm test` (vitest).

**Assets** — brand logo, 13 service images, 4 category images, 6 email heroes.

---

## 4. HARD BUGS FOUND IN THIS AUDIT

Fixed since the first audit (kept here so nothing gets re-introduced):

1. ✅ **Free-money webhook** — was: unauthenticated endpoint crediting any amount. Now signature-verified + idempotent (#1).
2. ✅ **Top-ups never credited** — wrong event name, no verify route, page ignored the callback. All three fixed (#2).
3. ✅ **Admin data readable by any logged-in user** — 8 admin routes had *no auth at all*. Now `requireAdminApi()` everywhere (#3).
4. ✅ **Demo login never worked** — it set a cookie named `session` while every reader looks for `pryva_session`. Now uses `createSession()`.
5. ✅ **Build was broken** — 113 type errors; `db` was `any`, the mock DB was missing 6 tables and had no `.offset()`, `params` weren't awaited (Next 16 requires promises). Fixed.
6. ✅ **`db.query.*` would crash on real Postgres** — `drizzle()` was called without `{ schema }`, so the relational query API didn't exist. Fixed.
7. ✅ **Supplier names in 8 user-facing places** — purged (#13).
8. 🟠 **Airtime + bulk orders still write balances directly** — no atomic guard, no idempotency (#4).
9. 🟠 **No security headers at all** (#6).
10. 🟠 **Auto-refund never runs** — logic exists, nothing schedules it (#17).
11. 🟡 **Schema drift** — 11 tables, 5 migrations.

## 5. WHAT'S GENUINELY LEFT (short version)

1. **Finish money safety** — ✅ airtime + bulk now atomic (#4), ✅ auth rate limits (#5). ⬜ security headers/CSP (#6) is the last item in this group.
2. **First live marketplace call** — add `ACCSZONE_API_KEY` to `.env`, then hit `GET /api/accounts/categories` and `GET /user/balance` (read-only) before buying anything.
3. **Marketplace polish** — FB/IG showcase on the homepage (#10), marketplace entry in the dashboard/digital page, order-detail credential view (done) and admin visibility of marketplace orders.
4. **Withdrawals end-to-end** — restyle the withdrawal screen to the site's design language, admin approve/reject single-item route.
5. Features: referrals, wishlist, reviews, coupons, tickets, SMS/WhatsApp, 2FA, PWA, analytics (#19–#28, #42–#43).
6. Real per-feature icons + provider/platform logos (#39); landing-page clarity for all offerings (#38).
7. Docs, CI, Docker, migrations hygiene (#46–#47).

## 6. IMPORTANT: DIVERGENCE FROM THE EARLIER SESSION

Your pasted log describes **2,300+ lines** of work (AccsZone client, referral system, wishlist, reviews, coupons, 2FA, SMS/WhatsApp, PWA, admin pages, payment integrity pages…). **Most of that is NOT in this repository.**

Verified facts:
- That work was committed to `arena/d3bfe606-pryva` and proposed as **PR #1 — status: CLOSED (never merged)** on 2026-10-26.
- Two later PRs **#2 and #3 were merged** ("Restore styles/preview assets, mobile nav, logo SVG IDs and demo DB flows" and "Complete app rebuild with service logos, animated payments, and demo login") — those are what's in `main` today: demo login, animations, service logos.
- `git log origin/main` here is a single commit (`d9927c1`), so the AccsZone branch is not reachable from this clone.

**Consequence:** everything in §2 marked ⬜ must be rebuilt from scratch, and I cannot "recover" the old code. That's fine — the audit above is a better spec than the old code anyway.

---

## 7. ANSWERS YOU GAVE (questions closed)

| # | Question | Your answer |
|---|----------|-------------|
| Q1 | Is the marketplace still required? | **Yes** — rebuild it (#7–#13). |
| Q2 | Do you have the supplier API key? | **Yes**, and it may resell every category. Key lives in `.env` as `ACCSZONE_API_KEY` — never in chat. |
| Q3 | Facebook/Instagram chargeback risk? | **Risk accepted.** Every category, FB/IG included. No re-litigating it. |
| Q4 | Money-safety before marketplace? | Followed: build fixed → money safety → marketplace. |
| Q5 | Keep all Tier-3 features? | Still open — assume yes until you say otherwise. |
| Q6 | Email + KYC? | Dropped/deferred as you instructed (no KYC, email waits for a domain). |

### Still open

| # | Question | Why it matters |
|---|----------|----------------|
| Q1 | **Is AccsZone still required?** PR #1 was closed. Do you want it rebuilt, or did you drop it? | It's the single biggest chunk (#7–#13). Rebuilding is ~2 weeks of work. |
| Q2 | Do you have an **AccsZone API key** and does reselling their accounts comply with their terms? | Without a key it's 🚫 blocked; account-reselling can breach platform ToS. |
| Q3 | Reselling **Facebook/Instagram accounts** carries legal + chargeback risk in Nigeria. Keep, or swap the showcase to safer accounts (ChatGPT, Netflix, Canva, Spotify)? | You asked for FB/IG prominence; I'd flag it as risky. |
| Q4 | Priority order: **money-safety first (#1–#6)**, then AccsZone, then features — agreed? | I propose yes. |
| Q5 | The 15-tier-3 features (referral, wishlist, reviews, coupons, tickets, SMS/WhatsApp, 2FA, PWA, analytics) — all still wanted, or trim? | Prevents rebuilding things you no longer care about. |
| Q6 | Email + KYC: you already said skip → confirmed dropped? | Marked 🗑 in my notes. |

---

## 8. CHANGE LOG

| Date | Change | Items completed |
|------|--------|-----------------|
| 2026-10-27 | Created plan file + first codebase inventory | — |
| 2026-10-27 | Loaded the full request log (R1–R42); verified every item against the checkout; discovered PR #1 was closed and most "done" features are absent; found 10 real bugs incl. a free-money webhook | — |
| 2026-10-27 | **Repaired the build.** 113 type errors → 0; `next build` passes. Typed `db` against the real schema, gave the mock DB the 6 missing tables plus `.offset()`, awaited Next 16's promise `params`, added the missing provider/fulfillment helpers, replaced the `lucide-react` imports with the in-house icon set, mounted the toast provider. | #0 |
| 2026-10-27 | **Money safety pass 1.** Webhook signature + `charge.success` + idempotency; new top-up verify route + client; `requireAdminApi()` on all 11 admin routes; atomic debits for orders/withdrawals/digital; withdrawal UI wired up; demo-login cookie bug fixed. | #1, #2, #3, #4 (partial) |
| 2026-10-27 | **Marketplace built.** Supplier client, FX with cache/fallback, pricing engine (markup + premiums + volume + floor), migration 005, four neutral `/api/accounts/*` routes, `/accounts` browse+buy UI with promo codes, credential viewer on order detail, supplier-name purge. | #7–#13 |
| 2026-10-27 | **Tests run.** Vitest + config + `npm test`: 12 files / 89 tests green, incl. new pricing (8) and webhook-signature (2) suites. | #44 |
| 2026-10-27 | **Merged `main` (PR #4, `5153fd4`) and unified the money paths.** Both branches had fixed the same holes; kept main's `payment_topups` model and `authorizeAdminApi()`, re-applied the marketplace on top. Found and closed a **double-credit window** created by the merge (webhook and browser callback each credited). Renumbered this branch's migration to `006`, restored mock-DB `.offset()` for withdrawal history, put `Accounts` back in the nav. 22 files / 156 tests green. | #1–#3, #44 |
| 2026-10-27 | **Audit + fulfilment safety + 3D art.** Full system audit (`AUDIT.md`), base migration `0000`, atomic airtime/bulk debits, auto-refund cron, sessions screen, refund/cookie policies, complete 3D icon set (19 PNGs, one per service), per-service artwork wiring, carrier marks, platform marks. | #4, #5, #20, #41, #44–#46 |
| 2026-10-27 | **Real logo + mobile-first homepage.** Owner's 3D mark cut out and wired through `BrandLockup` (header, footer, dashboard, admin, auth, 404, emails, favicon/app icons). Homepage hero rebuilt for phones (centred copy, stacked full-width CTAs, one hero card), services became a snap-scroll rail, added a sticky bottom CTA, closing panel carries the mark. Old 'no logo allowed' test rewritten. 179 tests green. | #16, #20 |
| 2026-10-27 | **Homepage strip got real marks.** The scrolling platform strip was 16 text pills; each now carries its own official logo (Binance, PayPal, Uber, Snapchat, Tinder, OKX added to the mark set). Added a luminance rule so yellow brands switch to a dark glyph. 177 tests green. | #26 |
| 2026-10-27 | **Real icons, not renders.** All third-party products and platforms now show official brand marks (`src/lib/brand-marks.ts`, extracted from simple-icons / @iconify-json/logos / devicon) instead of generated art; carriers use Airtel's official mark plus wordmark tiles; 60 countries got real flag SVGs with a `CountryFlag` component wired into pricing, checkout, numbers and eSIM. Six obsolete product PNGs deleted (images now 4.1 MB). 29 files / 176 tests green. | #26, #27 |
| 2026-10-27 | **API contract + hardening.** `requireAuthApi()` added and 22 route handlers migrated (signed-out callers were getting 500/307 instead of 401), wildcard CORS removed from `/api/*`, `no-store` on all API responses, footer `/accounts` duplicate key fixed. 26 files / 168 tests green. | #6 (partial), #45 |
| 2026-10-27 | **Auth throttling + admin console.** Per-IP/per-account login limits, per-IP signup limit (verified live: 6th bad attempt → 429), `/admin/users`, `/admin/orders`, shared admin nav. 23 files / 165 tests green, `next build` clean. | #5, #42, #45 |
| 2026-10-27 | **Profit band + nav cleanup.** Every price is now derived from a supplier cost sheet (`data/supplier-costs.json` → `npm run pricing:build` → `prices.generated.ts`) at 30–50% markup on cost; volume discounts, promos and bulk tiers are all clamped to a 30% floor; ₦500 minimum order closes the Paystack-fee leak; `PRICING.md` documents the rule, the audit command and the three face-value exceptions (airtime, data, gift cards). Homepage nav lost the Services dropdown (Home, Pricing, Accounts, How it works, FAQ, Contact). 204 tests green. | #13, #24, #26 |
| 2026-10-27 | **Homepage rebuilt around the phone.** Hero reordered (copy+CTA → photo → proof), services heading corrected from "Four" to nine with dashboard-only cards routed through sign-in, 3-up desktop grid, subscriptions strip for the orphaned `/digital-services`, new accounts marketplace band (FB/IG/TikTok), full-width bento, dashboard section given a real visual, pricing teaser replaced with live pay-as-you-go prices (fake Plus/Business tiers gone), invented ratings/counts removed, marquee seam fixed, section ids, FAQ JSON-LD, real `og.png`, skip link, sticky CTA that hides behind the closing CTA. 219 tests green (14 homepage). | #16, #20, #26 |


---

### HOW TO USE THIS FILE (for me, in future sessions)

1. Read this file **before** touching code.
2. Re-verify any ✅ with a file read — do not trust this table blindly.
3. Pick the lowest-numbered ⬜/🟡 item that you've confirmed.
4. When done: flip the status, add one line to §8, commit.
