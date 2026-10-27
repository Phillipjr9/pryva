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
| S5 | Rate limits on `/api/auth/*` | `authRateLimiter` exists and is **never imported** — login is unthrottled |
| S6 | Active sessions UI | **Fixed in this pass** — API existed, screen said "Coming Soon" |
| S7 | Admin users screen | `GET /api/admin/users` + `[id]` exist; only visitors are the dashboard tiles |

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
| O4 | CI: no `.github/workflows` — 156 tests exist but never run automatically |
| O5 | Dockerfile / deploy config |
| O6 | Cookie consent banner |
| O7 | Admin messages screen (`/api/admin/messages` has no page) |
| O8 | Base database migration | **Fixed in this pass** — see §5 |

### 3.6 UX / design

| # | Missing |
|---|---|
| U1 | ~~Dashboard sidebar uses generic line icons for Wallet/Orders/Data/Scheduled/Bulk~~ **Fixed** — 3D product art per nav item |
| U2 | ~~Provider logos (MTN/Airtel/Glo/9mobile) absent — text only~~ **Fixed** — hand-authored SVG marks (`NetworkBadge`) |
| U3 | ~~Platform logos (Facebook, Instagram, TikTok…) absent on `/accounts`~~ **Fixed** — hand-authored SVG marks (`PlatformBadge`) on cards + hero strip |
| U4 | Withdrawal screen still uses default form styling, not the site's design language |
| U5 | No loading skeletons on most dashboard screens |
| U6 | Facebook/Instagram hero showcase on the homepage (#10 in PLAN) |

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

### Images — regenerated as 3D renders

The old set was a mix of flat vector art, outlined icons and a UI mockup with readable text baked
in, at inconsistent aspect ratios (1024×1024 and 1408×768 mixed), totalling **18 MB**.

All regenerated as a single coherent system: **soft-clay/glass 3D renders** on the brand's warm
cream background, in the lavender/violet palette, no baked-in text, every file now a square.

| File | Status |
|---|---|
| `services/virtual-numbers.png` | ✅ 3D phone + call bubbles + SIM |
| `services/esim.png` | ✅ 3D eSIM chip + signal arc + globe |
| `services/proxies.png` | ✅ 3D server stack + shield |
| `services/email-otp.png` | ✅ 3D envelope + padlock + tokens |
| `services/data.png` | ✅ 3D signal tower + cloud droplet |
| `services/gift-cards.png` | ✅ 3D gift card + ribbon |
| `services/bulk.png` | ✅ 3D tile grid + arrow |
| `services/scheduled.png` | ✅ 3D calendar + clock |
| `services/digital-accounts.png` | ✅ **new** — 3D profile card + verified badge |
| `services/netflix.png` | ✅ **new** — 3D TV + play triangle + popcorn |
| `services/spotify.png` | ✅ **new** — 3D soundwave disc + music note |
| `services/youtube.png` | ✅ **new** — 3D play button + clapperboard + film |
| `services/disney.png` | ✅ **new** — 3D fairytale castle on a cloud |
| `services/chatgpt.png` | ✅ **new** — 3D iridescent orb + chat bubble |
| `services/canva.png` | ✅ **new** — 3D palette + brush + design tiles |
| `categories/streaming.png` | ✅ 3D play button + popcorn |
| `categories/music.png` | ✅ 3D headphones + soundwave |
| `categories/gaming.png` | ✅ 3D gamepad + dice + joystick |
| `categories/productivity.png` | ✅ 3D notebook + pencil + sticky notes |
| `email/hero-*.jpg` (6) | ✅ already 3D in the last pass — **re-cut this pass** from 1024² squares to 1200×600 banners so the email header reads as a header instead of a full-width square (396 KB total) |

Every digital product now has its **own** artwork (previously Netflix, YouTube and Disney+ all
shared one category image). The art is original 3D illustration themed around each product rather
than reproductions of third-party trademarked logos — that keeps the visual distinction you asked
for without shipping someone else's marks. The existing `logo-removal` test now asserts "one
distinct file per service" instead of "no per-service art".

**Optimisation:** centre-cropped to square and resized to 512×512 with PNG optimisation.
**18 MB → 4.0 MB** across 19 files (−78%) with no visible quality loss at the 20–64 px sizes the UI renders them.
The six email heroes are 1200×600 at q86 (396 KB for all six, down from 725 KB) and render at 600×300 inside the 600 px email column.

**Brand marks are never AI-generated.** Two hand-authored SVG sets cover the marks that must be
accurate: `src/components/NetworkBadge.tsx` (MTN / Airtel / Glo / 9mobile — distinct shapes, not one
generic oval) and `src/components/PlatformBadge.tsx` (Facebook, Instagram, TikTok, Gmail, Outlook,
X, Telegram, WhatsApp, Discord, YouTube, Netflix, Spotify, Steam). The second one also includes a
title/category matcher so a live listing titled "Instagram 5k followers" picks up the Instagram mark
on its card, with a neutral fallback for platforms we don't draw.

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

---

## 6. WHAT I'D DO NEXT (in this order)

**Week 1 — make it sell something real**
1. Connect one fulfilment provider end-to-end (numbers first) and prove a live purchase.
2. Email sender (Resend/SES) → receipts, verification, password reset. Unblocks S1, S2, F4.
3. Turn on `authRateLimiter` for `/api/auth/*` (10-line change, closes credential stuffing).

**Week 2 — close the money gaps**
4. Admin single-withdrawal approval + payment-audit screen.
5. Schedule `auto-refund` and add timeout coverage for eSIM/proxies.
6. Styled withdrawal screen.

**Week 3 — credibility & growth**
7. ~~Remaining images~~ **Done** — 3D set complete, carrier + platform marks hand-authored. Next art gap: homepage Facebook/Instagram showcase (U6).
8. Referrals + reviews (the two that move revenue).
9. CI workflow running `typecheck` + `test` + `build` on every PR.

**Week 4 — polish**
10. PWA, analytics, cookie banner, support tickets, 2FA.

---

## 7. HOW TO READ THE REST

`PLAN.md` remains the numbered backlog (48 items, statuses kept current).
This file is the *state of the system*; `PLAN.md` is the *task list*.
