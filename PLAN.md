# PRYVA — MASTER PLAN & MEMORY

> **What this file is:** the single source of truth for everything you've asked for, checked against the
> code that is *actually* in this repository. Read this first in any new session; update it after every task.
> Copy it freely. Nothing here is dropped — if something is impossible or not mine to decide, it stays on the
> list with a note.
>
> **Last updated:** 2026-10-27
> **Branch:** `arena/045f0b51-pryva` (based on `main` @ `d9927c1`)
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
| **1** | **Fix Paystack webhook — it currently mints free money** | 🟡 **BROKEN + EXPLOITABLE** | `src/app/api/webhooks/payment/route.ts`: signature check is **commented out**; body is trusted; credits `walletBalance + amount` for **any** POST. Also listens for `payment.success` while Paystack sends `charge.success`, so real payments never credit. Fix: verify HMAC (`verifyWebhookSignature` already exists in `paystack.ts`), use `charge.success`, credit via `creditWallet()`, idempotent reference. |
| **2** | **Add the missing top-up verification endpoint** | ⬜ | `wallet/topup` redirects back to `?topup=success`, but **no** `/api/wallet/topup/verify` route exists and `dashboard/wallet/page.tsx` never reads `searchParams`. So a user can pay and see no balance change. Needs verify route + client verification UI. |
| **3** | **Lock down admin APIs (no authz)** | ⬜ | `api/admin/{orders,stats,users}/route.ts` literally contain `// TODO: Add admin role check here`. Any logged-in user can read all users/orders. Needs one shared `requireAdmin()` helper applied to every `/api/admin/*` route + `/admin/*` pages. |
| **4** | **Route every balance change through `debitWallet`/`creditWallet`** | 🟡 | Airtime purchase does a raw `update(users).set({ walletBalance })` with no row lock, no idempotency (`api/airtime/purchase`). `gift-cards`, `digital/purchase`, `orders` already use the helpers. Needs migration + locking + unique reference on airtime. |
| **5** | **Rate-limit + bot-check the auth & payment endpoints** | 🟡 | `lib/rate-limit.ts` exists; verify it is applied to login/signup/demo/topup/webhook (not all routes). |
| **6** | **Security headers / CSP** | ⬜ | `next.config.ts` has **no** headers at all — no CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy. |

### 🟠 TIER 2 — The AccsZone marketplace (your R1, R2, R5, R6, R10)

| # | Item | Status | What's left |
|---|------|--------|-------------|
| **7** | AccsZone API client (`categories`, `subcategories`, `listings`, `purchase`, `orders`, `balance`, `promo`) | ⬜ | Nothing exists. Earlier attempt was **PR #1, which was CLOSED, not merged** — see §6. Must be rebuilt on this branch. |
| **8** | DB support for marketplace orders (stored credentials, provider order id) + migration | ⬜ | No such columns; `orders` has no credential store. |
| **9** | `/accounts` browse page: categories → subcategories → listings → search/sort → purchase modal → credential display | ⬜ | No `(site)/accounts` page, no `/api/accounts/*` routes. |
| **10** | Add "Digital Accounts" marketplace to catalog, dashboard nav, homepage showcase (**Facebook + Instagram featured**) | 🟡 | `/dashboard/digital` + `lib/digital-services.ts` already sell **6 own-catalog accounts** (Netflix, Spotify, YouTube, Disney+, ChatGPT, Canva). The *AccsZone* feed and the FB/IG showcase are missing. |
| **11** | Profitable pricing engine (base markup + category premium + volume discount + min-profit floor) | ⬜ | Nowhere. Current prices are static Naira in `lib/catalog.ts`. |
| **12** | Automatic USD→NGN rate with cache + fallback providers | ⬜ | Nowhere; no `exchange-rates` lib, no FX env vars. |
| **13** | Hide supplier names everywhere (no "AccsZone", no "Fleexa") | 🟡 **5 leaks live** | `(auth)/layout.tsx:62`, `how-it-works:71`, `(site)/page.tsx:123,240,1088`, `dashboard/page.tsx:121–130`, `components/dashboard/OrderActions.tsx:137`. Also `/api/integrations/fleexa` exposes the name in a URL. |

### 🟡 TIER 3 — Platform features you asked for

| # | Item | Status | Notes |
|---|------|--------|-------|
| **14** | Paystack wallet top-up (init → pay → verify → credit) | 🟡 | Init exists; **verify + credit broken** (see #1, #2). |
| **15** | Wallet withdrawal to bank (user request → admin approval → Paystack transfer → webhook) | 🟡 | API + `withdrawals` table + migration 004 + `paystack.ts` transfer functions exist. **Missing:** any withdrawal UI in `/dashboard/wallet`, and an admin approve/reject route (`admin/withdrawals/[id]/process`). |
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
| **44** | Automated tests that can actually run | 🟡 | **10 test files exist** (`airtime`, `bulk-orders` ×2, `catalog` ×2, `gift-cards` ×2, `order-status`, `scheduled-orders`, `validation`) but **no test runner installed and no `test` script** — so they never run. |
| **45** | Security suite: rate limiting, validation, anti-RE, sanitisation | 🟡 | ✅ `rate-limit`, `validation`, `security`, `protection`, `anti-reverse-engineering`, `sanitize`, `logger`, `errors`, `middleware`. ⬜ no `audit.ts` (audit trail), ⬜ no bot detection, ⬜ no CSP (#6), ⬜ unsigned webhook (#1). |
| **46** | Docs: README, RUNBOOK, .env.example, payment-flow doc | ⬜ | Only `PLAN.md` exists. |
| **47** | CI/CD, Dockerfile, migrations hygiene | ⬜ | No `.github/`, no Dockerfile. Only 4 SQL migrations while the schema has 11 tables → schema drift; several tables (airtime, reviews…) have no migration. |
| **48** | Preview / public URL for you to actually see the app | 🚫 | Blocked in this sandbox: tunnel tools (localtunnel/cloudflared/ngrok) can't reach the network, and the Arena preview panel didn't render. I can start the server here; still needs your side or a deploy (Vercel) to view. |

**Tally:** ✅ 11 done · 🟡 20 partial · ⬜ 16 not started · 🚫 1 blocked · ❓ 5 open questions.

---

## 3. WHAT ALREADY EXISTS (verified inventory)

**Stack** — Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Drizzle ORM + Postgres (mock DB fallback when `DATABASE_URL` is unset) · `canvas-confetti` · `simple-icons` · `pg`.

**Database (11 tables)** — `users`, `sessions`, `orders`, `wallet_transactions`, `contact_messages`, `gift_cards`, `scheduled_orders`, `notifications`, `security_violations`, `withdrawals`, `bank_accounts`.
Migrations: `001_add_gift_cards`, `002_add_scheduled_orders`, `003_add_security_violations`, `004_add_withdrawals`.

**Public site (17 pages)** — Home, About, Blog, Contact, Digital Services, Email OTP, eSIM, FAQ, Help, How it works, Pricing, Privacy, Proxies, Status, Terms, Testimonials, Virtual Numbers.

**Auth** — login, signup, logout, Google OAuth (start + callback), 3 demo flows, sessions, password change, profile, account delete, data export.
⚠️ No password reset, no email verification, no 2FA.

**Dashboard** — Overview, Wallet, Orders, Data Plans, Gift Cards, Bulk Orders, Scheduled, Support, Security, Settings, Notifications, Digital, plus order detail with live code sync.

**Admin** — Dashboard, Analytics, Security, Withdrawals. ⚠️ No role checks.

**API** — 52 route handlers across auth, orders, wallet, gift cards, airtime, digital, scheduled, notifications, admin, user, webhooks, health, search, cron.

**Libraries (~5.2k lines + additions)** — catalog, email-templates (6), anti-reverse-engineering, digital-services, security, payment-integrity, protection, paystack (init/verify/transfers/banks/webhook-signature), auth, fleexa, gift-cards, service-timeouts, auto-refund, scheduled-orders, airtime, bulk-orders, wallet, validation, rate-limit, sanitize, logger, errors, cache, net, google, format, utils.

**UI kit (22)** — Accordion, Alert, Badge, Button, Card, Checkbox, Confetti, DataTable, Dropdown, FaqAccordion, Input, Loading, Modal, PaymentLoading, PaymentSuccess, Reveal, Select, Skeleton, Tabs, Textarea, Toast, Tooltip.
Plus theme provider/toggle, command palette, site header/footer/nav, auth forms, brand logo, purchase flow.

**Tests** — 10 files (cannot run — no runner).

**Assets** — brand logo, 13 service images, 4 category images, 6 email heroes.

---

## 4. HARD BUGS FOUND IN THIS AUDIT (fix before launch)

1. 🔴 **Free-money webhook** — unauthenticated `/api/webhooks/payment` credits any wallet with any amount; signature verification commented out. (#1)
2. 🔴 **Top-ups never credit** — callback lands on `?topup=success` with no verify route and no client handler; the webhook that should save it listens for the wrong event name. (#2)
3. 🔴 **Admin data is public to any logged-in user** — `// TODO: Add admin role check here` in three admin routes. (#3)
4. 🟠 **Airtime bypasses the safe wallet path** — raw balance write, no lock/idempotency. (#4)
5. 🟠 **No security headers at all** — `next.config.ts` ships none. (#6)
6. 🟠 **Withdrawal has no UI and no approval route** — API exists, unusable end-to-end. (#15)
7. 🟡 **Auto-refund never runs** — the logic exists but nothing schedules it. (#17)
8. 🟡 **Tests are dead weight** — 10 suites, no runner. (#44)
9. 🟡 **Supplier names still visible** in 6+ user-facing places. (#13)
10. 🟡 **Schema drift** — 11 tables, 4 migrations.

---

## 5. WHAT'S GENUINELY LEFT (short version)

1. Money safety (#1–#6) — this is the only thing standing between you and real losses.
2. AccsZone marketplace end-to-end (#7–#13) — rebuild it; the old PR was closed.
3. Referrals, wishlist, reviews, coupons, tickets, SMS/WhatsApp, 2FA, PWA, analytics (#19–#28, #42–#43).
4. Real icons for every feature + provider/platform logos (#39).
5. Landing-page clarity for all 7 offerings (#38).
6. Docs, CI, migrations, runnable tests (#44–#47).

---

## 6. IMPORTANT: DIVERGENCE FROM THE EARLIER SESSION

Your pasted log describes **2,300+ lines** of work (AccsZone client, referral system, wishlist, reviews, coupons, 2FA, SMS/WhatsApp, PWA, admin pages, payment integrity pages…). **Most of that is NOT in this repository.**

Verified facts:
- That work was committed to `arena/d3bfe606-pryva` and proposed as **PR #1 — status: CLOSED (never merged)** on 2026-10-26.
- Two later PRs **#2 and #3 were merged** ("Restore styles/preview assets, mobile nav, logo SVG IDs and demo DB flows" and "Complete app rebuild with service logos, animated payments, and demo login") — those are what's in `main` today: demo login, animations, service logos.
- `git log origin/main` here is a single commit (`d9927c1`), so the AccsZone branch is not reachable from this clone.

**Consequence:** everything in §2 marked ⬜ must be rebuilt from scratch, and I cannot "recover" the old code. That's fine — the audit above is a better spec than the old code anyway.

---

## 7. OPEN QUESTIONS (I need these answered before building Tier 2)

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

---

### HOW TO USE THIS FILE (for me, in future sessions)

1. Read this file **before** touching code.
2. Re-verify any ✅ with a file read — do not trust this table blindly.
3. Pick the lowest-numbered ⬜/🟡 item that you've confirmed.
4. When done: flip the status, add one line to §8, commit.
