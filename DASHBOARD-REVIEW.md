# Dashboard review — the login blocker, then what the app actually looks like

Written after signing in as the demo account and walking every page
(`/dashboard`, `wallet`, `orders`, `data`, `gift-cards`, `bulk-orders`,
`scheduled`, `digital`, `security`, `settings`, `notifications`, `support`).
No dashboard code changed yet — this is the plan, per your standing rule.

---

## 1. The demo login — fixed

**Cause:** the demo button was a `type="submit"` inside a plain POST form, and its
`onClick` set state that immediately rendered the same button as `disabled`:

```tsx
<button type="submit" disabled={pending !== null} onClick={() => setPending("demo")}>
```

A submit button disabled *inside its own click handler* is removed before the
browser runs the form's default action, so **the form never posted**. The label
flipped to “Opening the demo…” and stayed there. No request, no error, no clue.

**Fix (`8de1447`):**

- the button no longer carries `disabled`; it exposes `aria-busy` and a
  `pointer-events-none` style while the request is in flight (that does not
  cancel a submit that already started);
- the form now runs the `submitDemo` handler that was already in the file but
  never wired up, so a refused demo (real database, where demo is disabled)
  shows its message in place instead of bouncing through a redirect;
- `action="/api/auth/demo-web"` and `method="post"` stay, so the demo still works
  with JavaScript disabled;
- regression test asserts the button is never rendered disabled.

Verified end-to-end on the server: `POST /api/auth/demo-web` → **303 →
/dashboard** with a session cookie, and `GET /dashboard` with that cookie →
**200** as “Ada Demo”. **Reload `/login` and try again** (an old tab still has
the broken bundle).

---

## 1b. Demo login, second report — the client request is gone

The demo was reported stuck again ("Opening the demo…" forever) after the shell
work. Evidence from the dev server log for the reported window:

```
GET  /login              200
POST /api/auth/demo      200   ← the previous session's own curl, not the click
(no request from the button at all)
```

A click that produces **no network request** and leaves the label on “Opening the
demo…” is the signature of the old bundle (the `disabled`-on-click version) still
running in the tab: React flips the label, then nothing is posted.

Rather than tell you to reload a third time, the demo no longer depends on
JavaScript at all:

- the button is a plain `type="submit"` in a `method="post"` form pointing at
  `/api/auth/demo-web`; the only handler is a cosmetic label change that does
  **not** call `preventDefault`;
- the server answers with a **303 → /dashboard** and sets the session cookie
  (`Secure; SameSite=none; Partitioned` when the page is inside the preview
  iframe), so the browser navigates by itself;
- `/api/auth/demo-web` now also accepts **GET**, and the login card renders
  “Button not responding? Open the demo directly” as a plain link — a guaranteed
  path if a browser ever swallows the submit;
- `pointer-events-none` is gone from the button too, so a second click is always
  accepted (a duplicate demo post is harmless);
- demo login now refuses politely on a real database (`?error=demo-failed`)
  instead of writing a demo user into production data.

Regression tests (5 in `demo-login.test.tsx`) assert the form still posts, the
button is never rendered disabled, **nothing intercepts the submit with a
client-side request**, and the fallback link is present.

### 1c. Why the tab kept serving old JavaScript

The follow-up symptom was a hydration mismatch on `/login`: the server markup
had the new "Open the demo directly" paragraph while the client tree expected the
old markup, and the click handler came from a bundle compiled before the change.
Two builds were live at once inside one tab.

`/login` itself is correctly dynamic (`cookies()` in `getCurrentUser`, plus
`searchParams`), so the HTML is fresh on every request — the stale half was the
JavaScript the tab had already loaded.

Fix: `src/lib/build-id.ts` + `VersionGuard`. The server renders a build id
(`VERCEL_GIT_COMMIT_SHA` in production, a per-process id in dev), exposes it at
`/api/version`, and the client compares on mount and whenever the tab regains
focus. If the tab is older than the server it reloads **once** — with two brakes
(build remembered, max two reloads per session) so a half-finished deploy can
never ping-pong a tab. Result: a deploy or a dev-server restart heals open tabs
instead of leaving a button that renders but does nothing.

---

## 2. What the demo account actually shows — nothing

Signing in as the demo lands you on a dashboard that says:

> Wallet balance ₦25,000 · Active orders 0 · Orders this view 0 · Refunded ₦0
> “No orders yet”

…while the header of that same page promises *“Explore the dashboard with
simulated orders and a preview wallet.”* The demo seeds a user and one welcome
credit, and **zero orders** (`src/db/index.ts:317`). A demo that shows an empty
state is a demo of the empty state.

**Fix:** seed 4–5 orders in different states — a live number with a code and a
timer, a rental, an eSIM, a refunded order, a gift card — with the matching wallet
debits, so the dashboard demonstrates codes, copy buttons, refunds and history in
one look.

---

## 3. The three numbers on the overview are wrong

`src/app/dashboard/page.tsx:41` loads the **last five** orders, then derives the
metrics from that list:

| Card | What it claims | What it computes |
|---|---|---|
| Active orders | live orders | active among the **last 5** |
| Orders this view | all orders | `recentOrders.length` (≤ 5, always) |
| Refunded to wallet | lifetime refunds | refunds among the **last 5** |

So a customer with 60 orders and ₦18,000 refunded sees “Orders this view 5” and
“Refunded ₦0”. These need aggregate queries (`count`, `sum` with a `where`), not a
slice of a list.

---

## 4. The overview doesn’t do the one job it has

For a numbers/inboxes product the most urgent thing on screen should be **a code
that is about to expire** — number, code, seconds left, copy button. That block
does not exist. Live orders are only reachable by Overview → Orders → order →
copy. Meanwhile the biggest element on the page is onboarding copy (“Your Pryva
wallet is ready.”) shown on every visit, plus a permanently visible amber strip
(“Preview mode: … simulated … do not deliver real services”) between the hero and
the stats.

Proposed first screen: **live codes → balance/actions → recent activity.**

---

## 5. Mobile top bar is overcrowded

At 390px, one row carries: menu button, brand lockup, “DASHBOARD / Hello, Ada”,
wallet chip and **Buy**. Five things, two of which repeat the drawer (brand and
greeting). The wallet chip is the first to be squeezed.

Two options (decision below): simplify the bar to *menu · page title · wallet*, or
move navigation to a **bottom tab bar** (Overview / Orders / Wallet / Buy /
Support), which is the pattern users of this kind of app expect on a phone.

---

## 6. Navigation gaps

The sidebar lists Overview, Wallet, Orders, Accounts, Data, Gift Cards, Bulk,
Scheduled, Support. Missing: **Notifications** (page exists, 106 lines, nothing
links to it), **Security** (sessions, password) and **Settings**. “Accounts”
points at the public `/accounts`, so it silently throws you out of the dashboard
shell. And there’s no grouping: buying, managing and support are one flat list of
nine.

Proposed: **Buy** (Accounts, Data, Gift Cards, Bulk, Scheduled, Digital) ·
**Manage** (Overview, Orders, Wallet, Notifications) · **You** (Settings,
Security, Support).

---

## 7. Smaller, still worth fixing

- **Digital accounts** (`/dashboard/digital`, 56 lines) is also unreachable from
  the sidebar.
- **Orders list has no filters or search** — active / refunded / all, plus a
  search box, are cheap and matter at 50+ orders.
- **H1 sizes differ page to page** (1.6rem hero on overview, 1.5rem “Wallet”,
  others smaller) and four pages are 20-line wrappers with their own spacing, so
  the pages don’t feel like one product.
- **Empty states are inconsistent** — dashed card on overview/wallet, plain text
  elsewhere.
- **Notifications has no bell** in the top bar, so the page is invisible.

---

## 8. Plan (in the order I’d do it)

**Phase 1 — make the demo real (small, highest impact)**
1. Seed demo orders + wallet debits (live code, rental, eSIM, refund, gift card).
2. Aggregate the three overview stats properly.
3. Replace the onboarding hero with a greeting, and fold the preview notice into
   a quiet inline chip.

**Phase 2 — overview that earns its place**
4. “Live codes” block at the top: number, code, expiry, copy, refund.
5. Balance card with Top up / Withdraw actions; recent activity below.

**Phase 3 — shell and mobile**
6. Mobile: bottom tab bar (or simplified top bar — your call).
7. Sidebar grouped Buy / Manage / You, including Notifications, Security,
   Settings, Digital.
8. Notifications bell with unread count.

**Phase 4 — page polish**
9. Orders: filters, search, date grouping, and a real order detail (copy buttons,
   refund, timeline).
10. One H1 scale, one empty-state component, consistent page spacing.

**Verification:** typecheck, tests (I’d add: demo login renders an active order,
stats match the ledger, every sidebar link resolves 200 as a signed-in user),
`next build`, and a logged-in crawl of all twelve dashboard routes.

---

## 9. Decisions I need

1. **Demo data** — seed realistic demo orders (recommended), or keep the demo as
   an empty-but-working account?
2. **Mobile navigation** — bottom tab bar (recommended) or simplified top bar?
3. **Overview order** — live codes first (recommended), or keep the money stats
   first?
4. **Scope now** — Phase 1 + 2 only, or all four phases in this pass?

---

## 10. What shipped (all four phases)

Decisions taken: seed the demo account, bottom tab bar on mobile, live codes
first on the overview, all four phases in one pass.

### Phase 1 — the demo account has a history

`ensureDemoUser()` (`src/db/index.ts`) now seeds five orders and the ledger that
matches them, instead of an empty account with a ₦25,000 credit:

| Order | State | What it proves |
| --- | --- | --- |
| `PV-DEMO0001` Nigeria number | active, code `482069`, expires in 20 min | the live-code block, timer, copy, refund |
| `PV-DEMO0002` Nigeria 7-day rental | active, 4 days left | long-lived windows render as `4d left`, not `5760:00` |
| `PV-DEMO0003` Nigeria eSIM 1GB | active, LPA string | eSIM activation details |
| `PV-DEMO0004` US number | refunded 9 days ago | refund history + ₦1,670 back to the wallet |
| `PV-DEMO0005` ₦5,000 gift card | active | non-refundable category in history |

The wallet ledger (welcome credit → purchases → top-up → refund → live purchase)
ends at exactly **₦25,000**, so the balance and the sum of transactions can never
disagree. Seeding is **per row**, not “if the user exists, stop”, so a preview
process that signed in before the orders existed still picks them up.
Two notifications are seeded (one unread) for the bell.

### Phase 1b — stats were derived from the five visible rows

`page.tsx` computed “Active orders”, “Orders this view” and “Refunded to wallet”
from `recentOrders = …limit(5)`. A customer with 40 orders and 12 refunds saw
“5” and the refund total of only the last five. Now:

```ts
db.select({ value: count() }).from(orders).where(eq(orders.userId, user.id))
db.select({ value: count() }).from(orders).where(and(eq(userId), eq(status,"active")))
db.select({ value: sum(orders.amount) }).from(orders).where(and(eq(userId), eq(status,"refunded")))
```

This exposed a **preview-database bug**: the in-memory adapter read the aggregate
name from `spec.name`, which Drizzle’s `count()`/`sum()` never set — every
aggregate silently returned `null`, i.e. `0`. It now reads the function name out
of the rendered SQL (`count(`, `sum(`, `avg(`), which also fixes the admin
console’s totals in preview mode.

### Phase 2 — overview order

1. Greeting (`Welcome back, Ada`) + Top up / Withdraw.
2. Quiet preview chip (the amber banner is gone).
3. **Live now** — number, digit tiles, one-tap copy, live countdown that turns
   amber at two minutes, “Expired” state, link to the order, refund note.
4. Balance card (dark) with **Active / All orders / Refunded** as real totals.
5. Recent orders + wallet activity.
6. Buy again (four services with their own marks).

`Withdraw` lands on `/dashboard/wallet#withdraw`, which scrolls to the withdrawal
form rather than the top of the wallet page.

### Phase 3 — shell

- Sidebar grouped **Manage** (Overview, Orders, Wallet) / **Buy** (Accounts, Data
  Plans, Gift Cards, Bulk Orders, Scheduled) / **You** (Notifications, Security,
  Settings, Support). Notifications, Security and Settings were previously
  unreachable from the navigation.
- Notifications bell in the top bar with an unread count, fetched once by the
  layout.
- Mobile: **bottom tab bar** (Home, Orders, Wallet, Buy, Support) with safe-area
  padding; the top bar is down to menu + brand + bell + Buy, so nothing is
  squeezed at 390px.
- **Nested shells fixed:** `settings`, `security` and `orders/[id]` each rendered
  their own `DashboardShell` *inside* the dashboard layout, producing a second
  sidebar and a second set of top bars. They now render content only.

### Phase 4 — pages

- Orders: status filters (All / Active / Refunded with counts), search over
  reference/product/region, month grouping, “Code live” marker, mobile card
  layout, and two distinct empty states (no orders vs. no search matches).
- Order detail: the existing `OrderActions` panel (number, code reveal, copy,
  countdown, refund) was never imported — it is now at the top of the order, and
  the duplicated OTP/Service Details cards are gone.
- One H1 scale (`1.5rem`, `1.7rem` from `sm`), one `EmptyState` component.

### Verification

`typecheck` clean · **226/226 tests** (4 new in `dashboard-demo.test.ts`: seeded
states, ledger consistency to the naira, aggregate correctness, unread count) ·
`next build` clean · logged-in crawl of all 14 dashboard routes plus
`?status=refunded` and `?q=` → 200, one `<aside>` per page.

### Still open

- `/dashboard/digital` is not in the navigation (public `/digital` covers it).
- `/accounts` still leaves the shell for the marketing page.
- Wallet/withdrawal styling (U4) and loading skeletons (U5) from `AUDIT.md`.

---

## 11. Round two — what is still rough

Four phases are in. Walking the signed-in app again, these are the remaining
gaps, in the order I'd fix them.

### A. Wallet and money (biggest visual break)

`wallet/WithdrawalDashboard.tsx` is 540 lines of `purple-600`, `gray-200`,
`rounded-xl` and default `Input` components — a different design system from
every other page. It also repeats the balance card the wallet page already
renders, and hides withdrawal status behind `bg-yellow-100` chips.
**Fix:** restyle to the shell's cards (`rounded-[1.5rem] border-line #fffdfa`),
drop the duplicate balance, show requests as a dated list with the four real
states (pending → processing → completed / failed), and keep the amount + bank
account flow intact.

Also in `wallet/page.tsx`: "added" and "spent" are summed from a `limit(40)`
slice — the same bug class as the overview stats. Should use `count`/`sum`.

### B. Security and settings (off-brand, thin)

Both pages still use `rounded-2xl border bg-white` with purple icon tiles and a
generic `Card`, so they look like a different product. Settings is 22 lines and
points at `SettingsForm`; Security is 118 lines of that generic markup.
**Fix:** bring both into the same section layout as Wallet/Orders, keep the
functionality, add "active sessions" to Security in the same card language.

### C. No loading states

Nothing under `/dashboard` has a `loading.tsx`, so every navigation is a blank
pause. **Fix:** a shared skeleton component plus `loading.tsx` for overview,
orders, wallet and the generic group — so the shell stays and only the content
shimmers.

### D. Navigation completeness

- `/dashboard/digital` exists (56 lines) but is in no nav list.
- `/accounts` still leaves the shell for the marketing page.

### E. Support page pass

124 lines, older markup; needs the same H1 scale and card treatment as the rest.

### Verification for each step

typecheck → tests → `next build` → signed-in crawl of every `/dashboard` route
plus the new ones, checking for one `<aside>` per page (the nested-shell bug from
round one).

### Shipped (round two)

| Area | Before | Now |
| --- | --- | --- |
| Withdrawal | 540 lines of `purple-600`/`gray-200`, duplicate balance card, no loading state | brand cards, balance passed in as a prop, segmented tabs, preset amounts, status pills for pending/processing/completed/failed, real empty states |
| Wallet totals | "added" and "spent" summed the newest 40 rows | `sum()` aggregates over the whole ledger, charges counted with `count()` |
| Settings | generic `Card`/`Input`/`Alert` set, 22-line page | brand sections, labelled fields, inline notices, disabled-until-changed save |
| Security | green/orange icon tiles, "Coming Soon" gray pills | launcher cards for password + 2FA, sessions card in brand style, two honest lists ("what we do" / "what keeps an account safe") |
| Loading | nothing | `loading.tsx` for the dashboard, orders and wallet, plus a shared `Skeleton` set |
| Accounts | nav item dumped you on the marketing page | `/dashboard/accounts` reuses `AccountsBrowser` inside the shell |
| Digital | in no nav list, and `?service=` never worked (searchParams read synchronously on a Next 16 promise) | in the sidebar, detail view reachable, renamed "Premium subscriptions" so it doesn't clash with Accounts |
| Gift cards / Scheduled | `green-100`/`yellow-100`/`gray-100` pills | emerald/amber/ink-toned pills |

Guard tests added (`dashboard-shell.test.ts`):
- every sidebar href resolves to a real page, and Accounts points inside the shell
- the ten important dashboard routes are reachable from the navigation
- the bottom bar has exactly five tabs
- no dashboard file reintroduces `purple-`/`indigo-`/`gray-` classes — this is
  what caught the two stragglers in gift cards and scheduled orders

Support page needed nothing: it was already on the brand palette and H1 scale.
