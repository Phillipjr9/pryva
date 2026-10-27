# PRYVA — SYSTEM AUDIT

> **What this is:** a line-by-line check of what actually exists in this repo versus what a
> marketplace like this needs, done by reading the code and hitting every route.
> **Date:** 2026-10-27 · **Branch:** `arena/a8db0ff3-pryva` (from `main` @ `89d7e6f`)
> **Method:** every page and API route requested over HTTP; every claim below traced to a file.

---

## 1. WHAT I ACTUALLY TESTED

**Public pages — 20/20 return 200:** `/`, `/about`, `/accounts`, `/blog`, `/contact`,
`/digital-services`, `/email-otp`, `/esim`, `/faq`, `/help`, `/how-it-works`, `/pricing`,
`/privacy`, `/proxies`, `/status`, `/terms`, `/testimonials`, `/virtual-numbers`, `/login`,
`/signup`, plus the two new legal pages added in this pass (`/refund-policy`, `/cookie-policy`).

**Dashboard — 12/12 return 200 when signed in:** overview, wallet, orders, data, digital,
gift cards, bulk orders, scheduled, support, security, settings, notifications.

**Real purchases executed end-to-end** (demo wallet):
- Virtual number → debited ₦1,200, order created, provider `simulated`
- Gift card → code issued, ₦5,000
- Data plan → chargered ₦500, delivered
- Digital service → rejected (`Invalid plan` — plan id mismatch, see §4)

**API:** 59 route handlers. Health, search, notifications, gift-card history, order list,
sessions, withdrawals history, scheduled orders, bank accounts all return 200.

---

## 2. THE HONEST SUMMARY

The **shell** of a complete marketplace is here: 20 public pages, 12 dashboard screens,
4 admin screens, 59 API routes, 12 database tables, 22 test files.

The **machine behind the shell** is mostly missing. In production today:

| Layer | State |
|---|---|
| Wallet, charging, refunds, idempotency | ✅ Real and tested |
| Payments in (Paystack) | ✅ Real, signature-verified, single credit path |
| Payments out (withdrawals) | ⚠️ Code exists, no admin single-item approval route, screen unstyled |
| Product fulfilment (numbers, eSIM, proxies, airtime, data, accounts, digital) | ❌ **Nothing is actually delivered by a live provider** |
| Email (receipts, verification, password reset) | ❌ No sender at all |
| Support tickets, referrals, wishlist, reviews, coupons, 2FA, PWA, analytics | ❌ Absent |

**The single biggest gap: this is a shop with no suppliers wired up.**
Every fulfilment path is either simulated (`provider: "simulated"`), gated to the preview
database (`isPreviewDatabase()` returns 503 in production), or a placeholder string
("Account credentials will be sent to your email within 5 minutes").

Files that say so in their own comments:

- `src/app/api/airtime/purchase/route.ts` → 503 unless preview
- `src/app/api/orders/bulk/route.ts` → 503 unless preview
- `src/app/api/digital/purchase/route.ts` → `// TODO: Integrate with account provider`
- `src/lib/fulfillment.ts` → returns `provider: "simulated"` when no provider key
- `src/lib/accszone.ts` → needs `ACCSZONE_API_KEY`, never yet called live

So the honest status is: **the marketplace is built, the supply chain is not connected.**

---

## 3. WHAT'S MISSING, BY AREA

### 3.1 Fulfilment / supply (highest impact)

| # | Missing | Impact | Where |
|---|---|---|---|
| F1 | Virtual number provider not connected | Core product sells, delivers nothing | `lib/fulfillment.ts`, `lib/fleexa.ts` |
| F2 | eSIM / proxy provisioning absent | Product page exists, no delivery path | `lib/fulfillment.ts` |
| F3 | Airtime & data provider absent (VTpass commented) | 503 in production | `api/airtime/purchase` |
| F4 | Digital accounts (own catalogue) → placeholder | "credentials will be emailed" with no email to send | `api/digital/purchase` |
| F5 | Bulk orders → 503 in production | Feature is preview-only | `api/orders/bulk` |
| F6 | Marketplace client never exercised live | Unknown whether the contract matches | `lib/accszone.ts` |
| F7 | No fulfilment timeout worker for eSIM/proxies | Auto-refund covers numbers only | `lib/service-timeouts.ts` |

### 3.2 Money

| # | Missing | Notes |
|---|---|---|
| M1 | Admin single-withdrawal approve/reject route | `PUT /api/admin/withdrawals` is a bulk handler; there's no `[id]/process` |
| M2 | Payment-audit screen | `lib/payment-integrity.ts` exists, no UI |
| M3 | Airtime/bulk `debitWallet` | **Fixed in this pass** (was read-modify-write) |
| M4 | Auto-refund scheduler | **Endpoint added in this pass**; needs a cron entry + `CRON_SECRET` |
| M5 | Refund for failed eSIM/proxy delivery | Only number orders are swept |

### 3.3 Accounts & security

| # | Missing | Notes |
|---|---|---|
| S1 | Password reset | No `forgot-password` route or page — users who forget are locked out permanently |
| S2 | Email verification | Signup accepts any address |
| S3 | 2FA (TOTP) | Three "Coming Soon" cards; no TOTP library or secret column |
| S4 | Login history | `security_violations` table exists, no per-user login log or screen |
| S5 | ~~Rate limits on `/api/auth/*`~~ **Fixed in this pass** — `/api/auth/login` 5/15min per account + 30/15min per IP, `/api/auth/signup` 10/hour per IP, 429 + `Retry-After` |
| S6 | Active sessions UI | **Fixed in this pass** — API existed, screen said "Coming Soon" |
| S7 | ~~Admin users screen~~ **Fixed in this pass** — `/admin/users` (search, wallet balances, order counts, spend) and `/admin/orders` (status filters, buyer email, search, pagination) |

### 3.4 Growth & retention

Absent entirely: **referrals** (codes, links, 5% reward), **wishlist**, **product reviews &
ratings**, **coupons** (marketplace promos are supplier-side only), **support tickets**
(`/dashboard/support` lists contact-form messages), **SMS/WhatsApp notifications**,
**newsletter**, **loyalty tiers**.

### 3.5 Platform & ops

| # | Missing |
|---|---|
| O1 | Email sender (`lib/email-templates.ts` has 6 designed templates, nothing sends them) |
| O2 | PWA: no manifest, service worker, offline page |
| O3 | Analytics: no GA4/Plausible/Web Vitals |
| O4 | CI: no `.github/workflows` — 168 tests exist but never run automatically |
| O5 | Dockerfile / deploy config |
| O6 | Cookie consent banner |
| O7 | Admin messages screen (`/api/admin/messages` has no page) |
| O9 | **Correction to an earlier note in this audit:** security headers were already shipping from `src/proxy.ts` (HSTS, nosniff, Referrer-Policy, Permissions-Policy, preview-aware X-Frame-Options). Only CSP is still open. |
| O8 | Base database migration | **Fixed in this pass** — see §5 |

### 3.6 UX / design

| # | Missing |
|---|---|
| U1 | ~~Dashboard sidebar uses generic line icons for Wallet/Orders/Data/Scheduled/Bulk~~ **Fixed** — 3D product art per nav item |
| U2 | ~~Provider logos (MTN/Airtel/Glo/9mobile) absent — text only~~ **Fixed** — Airtel's official mark + carrier wordmark tiles |
| U3 | ~~Platform logos (Facebook, Instagram, TikTok…) absent on `/accounts`~~ **Fixed** — real brand marks on cards, hero strip and every product tile |
| U4 | Withdrawal screen still uses default form styling, not the site's design language |
| U5 | No loading skeletons on most dashboard screens |
| U6 | ~~Facebook/Instagram hero showcase on the homepage (#10 in PLAN)~~ | **Fixed** — accounts marketplace band with real FB/IG/TikTok/X marks + `/digital-services` strip |
| U7 | Country flags were emoji only (rendered as "NG" on Windows) | **Fixed** — 60 real flags + `CountryFlag` on pricing, checkout, numbers and eSIM pages |
| U8 | The site had **no logo anywhere** — header, footer, dashboard and emails were text-only | **Fixed** — the owner's mark is now the brand everywhere (see §5) |
| U9 | Homepage hero stacked three overlapping cards on phones; services grid cramped at 2-up | **Fixed** — single clean hero card, snap-scroll service rail, sticky thumb-reach CTA |

---

## 4. BUGS FOUND IN THIS PASS

1. **`/api/wallet/banks` returned 500 with no Paystack key** — the withdrawal bank picker was
   therefore always empty, making withdrawals impossible. **Fixed**: bundled Nigerian bank list
   with a live-first strategy.
2. **Data / bulk purchases wrote the wallet balance directly** (read-modify-write, no guard) —
   double-spend possible on two concurrent taps. **Fixed**: atomic `debitWallet` + refund on
   failure + rate limits + phone-number validation.
3. **Session "current device" detection was always false** — the route compared a bearer token,
   but the app authenticates with an httpOnly cookie. **Fixed**.
4. **`api/digital/purchase` rejects valid-looking ids** (`netflix-1m`) — real ids are
   `netflix-1month`. Not a bug in the code, but the dashboard form and the catalogue need a check
   that they agree.
5. **No base migration** — a fresh production database could not be created from this repo.
   **Fixed** (§5).

---

## 5. WHAT I CHANGED IN THIS PASS

### Images — real brand marks and real flags

**The rule now:** anything that belongs to somebody else shows *its own real logo*; anything that is
Pryva's own invention keeps original artwork.

| Where | What it shows | Source |
|---|---|---|
| Third-party products (Netflix, Spotify, YouTube, Disney+, ChatGPT, Canva) | Official brand mark | `src/lib/brand-marks.ts` — generated from `simple-icons` (CC0), `@iconify-json/logos` (CC0) and `devicon` (MIT) |
| Platforms sold as accounts (Facebook, Instagram, TikTok, X, Gmail, Telegram, WhatsApp, Discord, Steam…) | Official brand mark | same file, rendered by `BrandIcon` |
| Homepage scrolling strip (16 platforms, WhatsApp → Spotify) | Official brand mark on every pill | `PLATFORM_SHOWCASE` + `BrandIcon` |
| Carriers (MTN, Airtel, Glo, 9mobile) | Airtel's official mark; MTN/Glo/9mobile as wordmark tiles (no redistributable logo exists) | `NetworkBadge` → `BrandIcon` |
| Countries (60 markets) | Real flag artwork | `public/images/flags/*.svg`, copied from `flag-icons` (MIT) by `scripts/copy-flags.mjs` |
| Pryva's own catalogue (virtual numbers, eSIM, proxies, email OTP, data, gift cards, bulk, scheduled, accounts) | Original 3D art — there is no "real logo" for a product we invented | `public/images/services/*.png` |
| Category tiles, email heroes | 3D art, unchanged | `public/images/categories/*.png`, `public/images/email/*.jpg` |

**Why the change:** the 3D renders looked good but read as "some streaming thing" at 20 px in the
dashboard, and a buyer scanning account listings needs to see Netflix as Netflix. Official paths are
also tiny (≤3 KB each, SVG, scales to any size) versus 250 KB PNGs.

**Contrast rule:** yellow/lime marks (Snapchat, Binance) would vanish as white-on-brand, so the
component computes the tile's luminance and flips the glyph to near-black — the way those brands
draw themselves.

**Gone:** `services/{netflix,spotify,youtube,disney,chatgpt,canva}.png` deleted — nothing referenced
them any more, and keeping two representations of the same product is how the wrong one ends up on a
page six months from now. `public/images` is now 4.1 MB, of which 428 KB is 60 flags.

**Flags, not emoji.** Emoji flags (🇳🇬) render as the letters "NG" on Windows and as nothing at all
in most email clients. `CountryFlag` resolves a plan's region string ("Nigeria", "US · 30 days",
"Europe (38 countries)") to real artwork, falling back to a drawn globe for bundles that have no
single flag (Africa, Global, "Any domain").

**Licensing note:** brand marks stay the trademarks of their owners and are used here only to
identify the product being sold — the same way a shop shelf label works. The icon *data* is
permissively licensed; the logos are not Pryva's to relicense. Re-extract with
`scripts/extract-brand-marks.mjs` after bumping the icon packages.

### Brand

The owner supplied the mark (glossy 3D violet "P"). It was cut out of the supplied
PNG — white background flooded away, the soft drop shadow dropped (light + neutral
pixels), the largest remaining component kept — and saved transparent, so it reads
on cream, white and the dark panels.

| Asset | Where |
|---|---|
| `public/images/brand/pryva-mark.png` (256) | UI lockups, email header |
| `public/images/brand/pryva-mark-512.png` | master for future crops |
| `public/icon.png` (512), `src/app/icon.png` (180), `public/apple-icon.png` (180), `public/favicon.ico` (16/32/48) | browser + install icons |

`BrandLockup` / `BrandMark` (`src/components/brand/BrandLockup.tsx`) is the single
source: site header (which previously had **no** brand at all), mobile menu, footer,
dashboard top bar and sidebar, admin nav, auth header, 404 and all six email
templates. `logo-removal.test.tsx` used to assert the opposite of this (it encoded an
earlier pass that deleted a placeholder logo); it now asserts the mark + name are
present everywhere and that the icon files exist.

### Pricing

The catalogue used to be a list of hand-typed naira prices with nothing behind
them — no cost, no margin, no way to answer "do we make money on this?". That is
now a pipeline, documented in `PRICING.md`:

- `data/supplier-costs.json` is the only place a buyer's cost lives. `npm run pricing:build`
  turns it into prices (30–50% markup on cost, rounded up to a step that fits the
  cost) and writes `src/lib/prices.generated.ts`; `npm run pricing:audit` prints
  the margin table.
- Costs stay out of the app bundle on purpose (the catalogue module ships to the
  browser). A test asserts the generated file carries no cost field.
- Every discount path is clamped to the 30% floor: marketplace volume tiers,
  promo codes, bulk-order tiers (the basket caps at its thinnest line's
  headroom). Category premiums now lift a category *inside* the band instead of
  past it (Facebook/Instagram were reaching 45%, now 48% max, never 55%).
- `fromPrice` is computed from real plan prices wherever plans exist, so a
  marketing "from ₦X" cannot go stale.
- A ₦500 minimum order is enforced at marketplace checkout because Paystack's
  flat ₦100 fee makes smaller orders loss-making even at a 50% markup.
- Exceptions are documented, not hidden: airtime, data and gift cards sell at
  face value and earn the reseller commission (2–5%). A 30–50% markup there is
  not a price any customer would pay.

**The costs themselves are placeholders** (seeded as the old price ÷ 1.3) until
the owner supplies real supplier invoices; the engine, the floors and the audit
are what shipped.

### Code

1. **Per-service artwork wired through the app** — homepage grid, pricing, the digital-services
   page and the dashboard sidebar now all use the new icons. The sidebar previously showed the
   same generic receipt icon for Data, Bulk and Scheduled.
2. **`digital-accounts` service added to the catalogue** — the marketplace now appears on the
   homepage grid, footer and sitemap with its own 3D icon (it only had a nav link before).
2. **Airtime/data purchases rewritten** — atomic debit, refund-on-failure, phone validation,
   rate limit.
3. **Bulk orders rewritten** — single atomic debit for the basket, all-or-nothing refund.
4. **Bank list fallback** — withdrawal picker works with or without Paystack.
5. **Auto-refund cron endpoint** — `POST/GET /api/cron/auto-refund` (secret-protected). The
   refund logic existed but nothing ever ran it.
6. **Active sessions screen** — real UI replacing a "Coming Soon" card; can sign out individual
   devices or all others.
7. **Legal pages** — `/refund-policy` (per-product refund matrix, automatic vs case-by-case vs
   never) and `/cookie-policy` (the three cookies actually set), linked in the footer + sitemap.
8. **Base migration** — `migrations/0000_base_schema.sql` creates all 12 tables; old incremental
   files moved to `migrations/legacy/` with a README explaining the order.
9. **Auth throttling** — `src/lib/auth-rate-limit.ts`: per-IP *and* per-account buckets on login,
   per-IP bucket on signup, cleared on a successful sign-in so real users never lock themselves out.
   Verified live: attempts 1–5 return 401, attempt 6 returns `429` with `Retry-After`.
   Counters are in-process, so a multi-instance deploy needs Redis/Postgres — noted in the file.
10. **API auth contract fixed (bug)** — 22 authenticated route handlers called `requireAuth()`,
    which *redirects*. Signed-out callers got a 500 (or a 307 to an HTML login page) instead of
    `401 {"error":"Unauthorized"}`. Added `requireAuthApi()` and migrated every route; verified
    five endpoints went from 500 → 401 and the signed-in demo still gets 200. Guarded by
    `src/test/api-auth.test.ts`.
11. **API traffic hardened** — `src/proxy.ts` was sending `Access-Control-Allow-Origin: *` and
    wildcard methods/headers on every `/api/*` response. Removed (same-origin only) and every API
    response is now `Cache-Control: no-store`. `x-powered-by` is off.
12. **Footer duplicate key fixed** — `/accounts` was rendered twice in the Services column (React
    logged a duplicate-key warning on every page). De-duplicated by href.
13. **Admin console** — real `/admin/users` and `/admin/orders` screens plus a shared admin nav
    (the stat tiles linked to pages that did not exist). Both are server-rendered, `requireAdmin`
    gated, paginated and searchable. **Not smoke-tested here**: preview mode has no `ADMIN_EMAILS`
    entry and the demo identity is barred from admin by design, so verifying them needs an
    admin account in `.env`.

---

## 6. WHAT I'D DO NEXT (in this order)

**Week 1 — make it sell something real**
1. Connect one fulfilment provider end-to-end (numbers first) and prove a live purchase.
2. Email sender (Resend/SES) → receipts, verification, password reset. Unblocks S1, S2, F4.
3. ~~Turn on `authRateLimiter` for `/api/auth/*`~~ **Done** — per-IP + per-account buckets live.

**Week 2 — close the money gaps**
4. Admin single-withdrawal approval + payment-audit screen.
5. Schedule `auto-refund` and add timeout coverage for eSIM/proxies.
6. Styled withdrawal screen.

**Week 3 — credibility & growth**
7. ~~Remaining images~~ **Done** — 3D set complete, carrier + platform marks hand-authored. Next art gap: homepage Facebook/Instagram showcase (U6).
8. ~~Real supplier costs into `data/supplier-costs.json`~~ **Open** — engine live, numbers pending invoices. Referrals + reviews next.
9. CI workflow running `typecheck` + `test` + `build` on every PR.

**Week 4 — polish**
10. PWA, analytics, cookie banner, support tickets, 2FA.

---

## 7. HOW TO READ THE REST

`PLAN.md` remains the numbered backlog (48 items, statuses kept current).
This file is the *state of the system*; `PLAN.md` is the *task list*.

---

## 8. HOMEPAGE PASS (2026-10-27)

Full findings live in `HOMEPAGE-REVIEW.md`. Closed in this pass: the 2-column
services grid at every width, the bento squeezed into 55% of the page, the empty
half of the dashboard panel, the inconsistent vertical rhythm, the marquee seam,
"Four services" over nine cards, four cards (and footer links) that bounced guests
to `/login`, the unimplemented Plus/Business pricing tiers, invented "4.9/5" and
"4,200+ delivered" claims, the orphaned `/digital-services` page, the missing OG
image, the missing FAQ structured data, the glued H2 word breaks, and the sticky
CTA covering the closing CTA.
