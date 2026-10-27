# PRYVA — MASTER PLAN & MEMORY

> **What this file is:** the single source of truth for everything requested in this project.
> Every request gets a numbered item here, marked with what already exists and what is left.
> I update this file **before** building anything and again after each piece of work lands, so
> nothing gets lost if the conversation gets long. The user can copy this file at any time.
>
> **Last updated:** 2026-10-27 (session start — backlog not yet loaded)
> **Branch:** `arena/045f0b51-pryva` · **Base commit:** `d9927c1`

---

## HOW WE WORK (rules I follow)

1. User sends requirements (in any length / any language, typos welcome). I do **not** start coding.
2. I convert the message into numbered plan items in **Section 2**, one item per deliverable.
3. For each item I verify against the actual codebase and set a status:
   `✅ Done` · `🟡 Partial` · `⬜ Not started` · `❓ Ambiguous / needs a decision` · `🚫 Blocked` (e.g. needs API key)
4. I show the plan back, user corrects/confirms, **then** I build — one item at a time, top to bottom.
5. After each item is built: update status, append to the change log (Section 6), commit on this branch.
6. Nothing is silently dropped. If I disagree or something is impossible, it stays on the list with a note.

**Status legend for this file:** `✅` done & verified · `🟡` partially built · `⬜` not started · `❓` needs user decision · `🚫` blocked on external dependency

---

## 1. RAW REQUEST LOG

_Verbatim / condensed record of what the user actually asked for. I append here so wording can never be re-interpreted later._

| # | Date | What the user asked (condensed) | Full text stored where |
|---|------|--------------------------------|------------------------|
| — | —    | _(awaiting the long requirements message)_ | — |

---

## 2. THE PLAN / BACKLOG

_This is the copy-paste-able list. Filled in from the raw request log._

| # | Item | Area | Status | Notes / what's missing |
|---|------|------|--------|------------------------|
| — | _(awaiting requirements)_ | — | — | — |

**Summary right now:** 0 done · 0 partial · 0 not started · 0 questions

---

## 3. WHAT ALREADY EXISTS IN THE REPO (audited 2026-10-27)

So we never rebuild something that is already there. Verified by reading the tree, not guessed.

### Stack
- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Drizzle ORM + PostgreSQL · `pg`
- Extras installed: `canvas-confetti`, `simple-icons`, `dotenv`
- Scripts: `dev` (binds `0.0.0.0`), `build`, `start`, `lint`, `typecheck`
- DB config: `drizzle.config.json` · migrations in `/migrations` (raw SQL)

### Database tables (`src/db/schema.ts`)
`users` · `sessions` · `orders` · `wallet_transactions` · `contact_messages` · `gift_cards` · `scheduled_orders` · `notifications` · `security_violations` · `withdrawals` · `bank_accounts`

### Migrations applied-as-files
`001_add_gift_cards` · `002_add_scheduled_orders` · `003_add_security_violations` · `004_add_withdrawals`

### Public marketing site (`src/app/(site)/`)
Home (1110-line landing) · About · Blog · Contact · Digital Services · Email OTP · eSIM · FAQ · Help Center · How It Works · Pricing · Privacy · Proxies · Status · Terms · Testimonials · Virtual Numbers
Shared layout with header, nav, footer, theme toggle (light/dark).

### Auth
Login · Signup · Logout · Google OAuth (start + callback) · demo login flows (3 variants) · `src/middleware.ts` guard · `src/lib/auth.ts` (session/token handling) · password change, profile, sessions list, account delete, data export APIs.

### Customer dashboard (`src/app/dashboard/`)
Overview · Orders · Wallet (top-up, withdraw, bank accounts, transaction export) · Bulk Orders · Data/Airtime · Digital Accounts · Gift Cards · Scheduled Orders · Notifications · Security · Settings · Support

### Admin (`src/app/admin/`)
Dashboard · Analytics · Security · Withdrawals (+ manager component)

### API surface (47 route handlers)
- **auth:** demo, demo-login, demo-web, google, google/callback, login, logout, signup
- **orders:** `orders`, `orders/list`, `orders/purchase`, `orders/bulk`, `orders/[id]/refund`, `orders/[id]/sync`
- **wallet:** `wallet/topup`, `wallet/withdraw`, `wallet/withdraw/history`, `wallet/banks`, `wallet/bank-accounts`, `wallet/verify-account`, `wallet/transactions/export`
- **gift cards:** check, history, purchase, redeem
- **digital / airtime:** `digital/purchase`, `airtime/plans`, `airtime/purchase`
- **scheduled:** `scheduled-orders`, `cron/scheduled-orders`
- **admin:** analytics, export, gift-cards, messages, orders, refunds, security/metrics, stats, users, users/[id], withdrawals
- **user:** delete, export, password, profile, sessions
- **platform:** contact, health, search, security/report, notifications, notifications/mark-read, webhooks/payment, integrations/fleexa

### Domain / business logic (`src/lib/`, ~5.2k lines)
`catalog` (623) · `email-templates` (464) · `anti-reverse-engineering` (398) · `digital-services` (301) · `security` (279) · `scheduled-orders` (233) · `validation` (191) · `protection` (183) · `paystack` (183) · `auth` (180) · `fleexa` (174) · `gift-cards` (170) · `payment-integrity` (146) · plus airtime, auto-refund, bulk-orders, cache, date-utils, demo, error-handling, errors, fulfillment, fulfillment/provisioning, format, google, logger, net, photos, rate-limit, sanitize, service-timeouts, wallet, utils

### Components already built
UI kit: Accordion, Alert, Badge, Button, Card, Checkbox, Confetti, DataTable, Dropdown, FaqAccordion, Input, Loading, Modal, PaymentLoading, PaymentSuccess, Reveal, Select, Skeleton, Tabs, Textarea, Toast, Tooltip
Site: SiteHeader, HeaderNav, SiteFooter, ServicePageTemplate, ContactForm
Dashboard: TopUpForm, ExportTransactionsButton, WithdrawalDashboard, SettingsForm, DataPlansForm, GiftCardsManager, PlanPurchase
Other: CommandPalette, ThemeProvider, ThemeToggle, icons.tsx

### Tests (10 files, homegrown node test files in `src/test/`)
airtime · bulk-orders (+extended) · catalog (+extended) · gift-cards (+extended) · order-status · scheduled-orders · validation

### Assets
`public/pryva-logo.png` · `public/images/services/*` (13) · `public/images/categories/*` (4) · `public/images/email/*` (6 hero images)

---

## 4. KNOWN GAPS FOUND DURING AUDIT

Real issues spotted in the code while auditing — these may or may not overlap with the user's list.

| # | Gap | Where | Severity |
|---|-----|-------|----------|
| G1 | Admin API routes have `// TODO: Add admin role check here` — no authorization gate | `api/admin/{orders,stats,users}/route.ts` | 🔴 security |
| G2 | Digital purchase marks order delivered with a **placeholder**, no real credential provisioning | `api/digital/purchase/route.ts:77` | 🟠 functional |
| G3 | Dashboard Security page: 3 features show "Coming Soon" (2FA / etc.) | `dashboard/security/page.tsx:61,81,101` | 🟡 incomplete |
| G4 | No `README.md`, no `docs/` folder, no plan file (this file is new) | repo root | 🟡 docs |
| G5 | No CI workflow (`.github/`) — lint/typecheck/tests not automated | repo root | 🟡 infra |
| G6 | Tests are ad-hoc files, not wired into `npm test` script | `package.json`, `src/test/` | 🟡 infra |
| G7 | 4 SQL migrations exist but were applied outside Drizzle's journal — drift risk | `migrations/` | 🟡 infra |

---

## 5. OPEN QUESTIONS FOR THE USER

| # | Question | Why it matters |
|---|----------|----------------|
| Q1 | _awaiting the requirements message_ | — |

---

## 6. CHANGE LOG

| Date | What changed in the plan | Items completed |
|------|--------------------------|-----------------|
| 2026-10-27 | Created this plan/memory file; audited the existing codebase (Sections 3–4) | — |
