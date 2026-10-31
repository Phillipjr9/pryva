# PRYVA — MASTER PLAN & MEMORY

> **What this file is:** the single source of truth for everything you've asked for, checked against the
> code that is *actually* in this repository. Read this first in any new session; update it after every task.
> Copy it freely. Nothing here is dropped — if something is impossible or not mine to decide, it stays on the
> list with a note.
>
> **Last updated:** 2026-10-30 (PRs #18–#28 merged; temporary email made free on this branch)
> **Branch:** `arena/608d860b-pryva` (`main` @ `e9fa62a`, PRs #27 and #28 merged). **Merging a PR does not close its branch**, and each Arena session gets a fresh one — this branch carries the free-email change described in R49.
> **Repo audit method:** every status below was verified by reading files in the checkout — not from memory,
> not from the earlier chat log.
>
> ⚠ **This file is the durable memory. Anything outside the repository does not survive** — switching
> branch resets the sandbox and wipes untracked files at `/home/user`. A separate expansion plan kept
> there was lost that way on 2026-10-30. Record decisions here, in the commit, or in the PR body.
>
> ⚠ **SEQUENCING — read before setting any supplier key.** `isMarketplacePurchaseEnabled()` returns
> true the instant `BULKACC_API_KEY` exists, and the purchase route checks that gate *before* it
> branches on hand-sourced items. So that one key also opens checkout for the six streaming products
> in `data/manual-catalog.json`, whose only fulfilment path is `/admin/fulfilment` → `requireAdmin` →
> `isAdminUser`, which needs a **verified** address. With no mail provider nobody can be verified, so
> those orders would sit in `processing` forever. **Unblock admin first** (PR #25 makes the sale refuse
> instead, but the fix is to make the queue reachable). Same root cause as withdrawals never completing.

---

> ⚠ **The §2 backlog is stale as of 2026-10-30.** Several items it marks ⬜/🟡 have since shipped and
> were verified in the checkout: the README, `/refund-policy` and `/cookie-policy`, the settings data
> export, admin users/orders/refunds/messages/margin pages, admin authorisation, and the disposable
> inbox (migration `0013`, `/dashboard/inbox`, `/api/inbox/*`). Item #15 also claims `transfer.success`/
> `transfer.failed` webhooks settle withdrawals; no such handler exists — settlement is manual, which is
> what the README says. **`STATUS.md` is the verified snapshot taken at `19113f0`**; read it before
> picking work, and correct the tables below as items close rather than adding a second backlog.

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
| R43 | **"I don't want any manual input for any service"** — no hand-prepared orders, no admin fulfilment queue, no hand-maintained catalogues | **#26** |
| R44 | **"I want all the marketplace and services to be fetched with API connectivity"** — if a feed does not return it, it is not inventory | **#26** |
| R45 | **"I don't agree to the deletion, I want all the service"** — rejected removing streaming/proxies/airtime/boosting; every category stays and gets a feed instead | open |
| R46 | Gift cards: no API exists, "but you can recommend" | answered in chat |
| R47 | "Can you reverse engineer and work with fakemailo.com — I think it has some things I will need" | **answered: no, and it is not needed** |
| R48 | (implied by R47) Make the temporary-inbox category deliverable | **#28** |
| R49 | **"can the email be temporary email and free?"** then, as a business argument: *"there's thousands of temporary email providers that doesn't require fees… do you think user will leave free service and paid for mine? so we need to think as a business owner, generating free email doesnt mean other service is free too"* — email is free to the customer permanently; **every other service keeps its price** | **this branch** |
| R50 | **"remove the EXAMPLE VERIFICATION Sample only / +234 ••• ••• •••• / Nigeria · sample number / 482069 at the top of the image on homepage"** — the fake verification card layered over the hero photo | **this branch** |
| R53 | **"under email otp all the services doesnt use there logo icon and i want you to look into all the entire system service and make sure they using there right logo icon"** — every service surface must show that service's own icon | **this branch** |
| R59 | **"1. block temp email at signup · 2. account lockout · 3. update terms · 4. database backups · 5. make it not vulnerable to hackers · 6. add our social platforms (TikTok, X — not live yet) · 7. track every admin transaction and reconcile daily"** | **this branch (6 of 7; socials need handles)** |
| R58 | **"okay go on"** — to the two homepage upgrades offered at the end of R57: self-hosted webfonts, and `Organization`/`WebSite` structured data | **this branch** |
| R57 | **"the gift card shouldnt be part of the categories at all, because its not services"** — gift cards are wallet credit, not a catalogue service | **this branch** |
| R56 | **"can you fix the whole website because when using mobile phone with different screen size user will have to adjust the screen zoom"** — phone legibility and layout | **this branch** |
| R55 | **"yes"** — to the two upgrades offered at the end of R54: sized icon derivatives, and self-hosting the hero photograph | **this branch (icons done, hero blocked)** |
| R54 | **"do you think the homepage need more upgrading? and remove any duplicate services that occuring twice"** — dedupe the homepage, and judge what else it needs | **this branch** |

**R47 verdict, with the reason, so it is not re-litigated in a later session.** fakemailo.com is a free
ad-supported temp-mail site with no published API, no pricing and no developer terms. Its own Terms of
Use say: *"Any emails received to the temporary addresses created on our platform are **publicly
accessible** for the duration of their lifetime. **Do not use our service for receiving sensitive or
personal data**"*, that it is offered *"as-is, with no guarantee of availability, security, or email
delivery"*, and that they *"may modify, suspend, or terminate the service at any time without notice."*
So it cannot be inventory for a paid inbox: the thing sold would be an inbox anyone can read, on a
service that can disappear mid-order after money is taken. Scraping undocumented internal endpoints
would also be untestable from this sandbox, whose egress allows only github.com, npm and pypi.

**It is also unnecessary.** `src/lib/fleexa.ts` already implements Email OTP end to end —
`/email/products`, `/email/buy`, `/email/check/:id`, `/email/cancel` — and `FLEEXA_API_KEY` went live
on Production 2026-10-30 14:31. The four `email-*` plans are undeliverable only because they are
absent from `FULFILMENT_MAP` (10 slugs, all `vn-*`/`rent-*`). The work is wiring, not scraping.
Its own header comment is the standing caveat: the contract *"has not been confirmed against a live
key: smoke-test a single cheap purchase before taking customer money."*


**R49, and why it is settled rather than open.** A disposable inbox is a commodity whose effective market
price is zero — free services hand one out in a click — so charging ₦790–₦13,950 for one was never going to
sell. It also could never have been *delivered*: the supplier's email products expose no duration, so a
24-hour and a 30-day inbox are the same purchase upstream (`src/lib/fulfillment.ts`). Both halves point the
same way, so the four tiers are gone rather than gated, and the inbox becomes a free tool attached to an
account — no plan, no cost-sheet entry, no price, no order row. This is the one authorised exception to R45
("I want all the service"): the *category* stays, its paid tiers do not.

**What is still open, and it is about cost, not price.** Free to the customer does not mean free to run.
Two ways to source an inbox: **(A)** the existing supplier feed, where each inbox costs us roughly ₦540 by
the old cost sheet — an estimate dated 2026-10-27 that PR #28's probe now returns properly as the feed's own
`priceNgn`; or **(B)** our own domain with inbound email (SES inbound parse, Cloudflare Email Routing,
Mailgun routes), where receiving costs on the order of $0.10 per 1,000 messages — under ₦2 an inbox — and
the same domain would unlock password resets and email verification. **(B) is the better business case once
it exists, because a free inbox is an acquisition channel and its cost per signup is the whole point**, and
because verified email is what would make "signed-in users only" a real cost control instead of a formality
(transactional email is parked, so today anyone can mint unlimited accounts). It needs a domain, which only
the owner can buy.

**Rejected, with reasons, so this is not re-litigated:** free public temp-mail APIs. Mail.tm is genuinely
free with no key and no paid tier, but its terms **require attribution and prohibit reselling or mirroring the
API under your own domain**, and its disposable domains are blocklisted within days (`uberip.com` was flagged
the day it launched). fakemailo's terms make every inbox **publicly readable** and reserve the right to
terminate without notice — wrapping that would expose our users' OTP codes to strangers, which is worse than
charging for them. An inbox that target sites reject, or that anyone can read, is not a feature. See R47.

**Still to build:** the inbox itself (`disposable_inboxes` table via migration `0012`, one active inbox per
user enforced by a **partial unique index** rather than an application check — two concurrent requests would
race past a check and buy two inboxes, spending twice), a per-IP daily cap, create/poll/discard routes, and
the viewer UI (`checkFleexaEmail()` already returns subject, from, body and a parsed `code`). All five PGlite
test files hardcode a migration filename list, so every one of them needs a new file added or they silently run
a stale schema. **(Updated by R51: `0012` is now the withdrawal payer-name migration, so the inbox becomes
`0013`; and the list is four fixtures, not five — `shared-rate-limit.test.ts` replays `0002` alone on purpose.
`withdrawal-name-check.test.ts` now fails if any fixture forgets a migration file.) **Not authorised yet:** the one paid smoke test that would confirm the feed's contract, which its own
header comment says *"has not been confirmed against a live key."*

**R50, done.** The hero photo carried a decorative card dressed as a product screenshot — "Example
verification / Sample only", a masked `+234 ••• ••• ••••`, "Nigeria · sample number", six digits and an
"Expires in 00:19" countdown. Removed outright (53 lines) at the owner's request; the photo and its gradient
overlay stay. Nothing tested that card, so it is now pinned by a test that fails if it comes back.

**What was deliberately left alone:** the "04 / Your dashboard" section still shows an illustrative order
("Example Order PV-2291", code 814027, its own "Expires in 00:19"). That one is doing real work — it shows
what the dashboard looks like — and it shares wording with the card that went, so a broad assertion like
`not.toContain("Expires in")` would fail for the wrong reason. If the owner wants that removed too, it is a
separate decision.

**Two open-PR collisions avoided while doing this** (the same technique as R47/R48): PR #30 edits the same
three files, so this change's test went into a new `describe("homepage hero")` at the *end* of
`homepage.test.tsx` (old lines 128+ versus PR #30's insertion at 120–125) and this record went into §1
rather than §8, where PR #30 appends. Both PRs stay mergeable in either order.

**R51, done — five requests, all five shipped.**

**(1) Password eye toggle.** New `src/components/ui/PasswordInput.tsx` (`"use client"`, typed as
`Omit<InputHTMLAttributes, "type">` so no caller can pin the mode back to hidden), with `aria-pressed`,
`aria-controls` and a `useId` fallback, and an inset transparent button so it sits correctly in both field
styles. `EyeOff` added to `icons.tsx`. All **six** `type="password"` inputs converted: `AuthForm` (1),
`reset-password` (2), settings (3).

**(2) "The user settings looks empty."** The page had two sections; it now has five (Profile, Password, **Email
verification**, Account, Your data). The new section surfaces `user.emailVerifiedAt`, which was already in
`PublicUser` and never displayed anywhere. Auditing it found **three features that were built but unreachable**:
`POST /api/auth/verify-email` — its own comment calls it *"the only in-app path that re-requests one"* — had no
link to it; the dashboard's unverified-email banner is gated on `resendConfigured()`, so with Resend unset an
unverified user saw nothing at all; and `/api/user/delete` returns 503 **by design** (it would cascade into
wallets, orders, payment records and issued gift cards before any retention design exists). The first is now
linked from settings, the second is why the section states the truth instead of offering a resend button that
would fail, and the third was **left alone deliberately** — no button was wired to a dead endpoint.

**(3) Nav promo card removed.** The "New order / Choose a country and explore numbers, social services and
more / Browse services" card is gone from `DashboardShell.tsx`. `Sparkle` and `ArrowRight` are still used
elsewhere in that file, so no import was orphaned; the separate "New order" button on the orders page is not
the nav bar and was left in place.

**(4) "User can't add bank account for withdrawal."** The whole flow **exists and is correct**: the dashboard
verifies via `/api/wallet/verify-account`, then saves via `/api/wallet/bank-accounts`, which re-resolves the
name with Paystack, 409s if it changed since review, creates the transfer recipient and inserts
transactionally. The name is never client-supplied. The likely cause is environmental, not a bug: **the
Paystack key is still `sk_test_`, and test mode cannot resolve real Nigerian bank accounts**, so verification
400s, `accountName` stays empty and "Save bank account" stays permanently disabled — which reads as a broken
button. Added `paystackKeyMode()` to `paystack.ts`, which returns `test`/`live` from the key's **prefix only**
(a mode indicator, never the key), and extended diagnostics to `payments.{configured, keyTail, mode, banks}` so
the owner's `curl` now settles the question. Also added persistent inline verify errors — the failure used to
show only as a toast that vanished under a greyed-out button.

**(5) ★ The money rule: a payout may only go to the name that funded the wallet.** *"dont ever send money to
third party account."* Ownership was already enforced (a withdrawal can only name an account belonging to the
signed-in user), but that ties the account to a **session**, not to the person who sent the money — it left the
mule payout wide open: add a bank account in somebody else's name, withdraw to it, and the platform is the
route between two identities. Closed:
- **Migration `0012_topup_payer_name.sql`** adds `payment_topups.payer_name`. It is written by `completeTopUp`,
  the single place money enters a wallet, **only on the `pending → completed` transition**, so a duplicate
  Paystack delivery cannot overwrite it with a name edited in between.
- The reference is that frozen column and **never `users.name`**, which `/api/user/profile` edits at any time.
  A reference that can be changed after the money arrives cannot prove who sent it — and a test now renames the
  profile and re-points the bank account to prove the payout is still refused.
- **Existing rows are left NULL on purpose.** Backfilling from the current profile name would launder exactly
  the rename this exists to stop. A NULL **fails closed** rather than being treated as a match.
- `comparePayoutNames` accepts the same name in any order, ignoring accents and titles, allowing **at most one**
  extra token for the middle name a bank record carries, and requiring **two** overlapping tokens so a shared
  surname alone can never pass: "Ada Obi" matches `ADA OBI`, `OBI ADA`, `ADA OBI CHUKWUEMEKA`; it refuses
  `BOLA ADEYEMI`, `CHINEDU OBI`, `ADA OBINNA`, `Ada`, and `ADA OBI CHUKWU OBIORA`.
- Enforced in the withdrawal route **before any write** — no row, no debit, no ledger entry — and again when
  saving a bank account, but there **only when a deposit name exists**. Refusing on the profile name would lock
  out genuine customers whose bank record spells their name differently, for no security gain.
- The rule is stated in the UI up front (bank-account form and the final review dialog) rather than discovered
  as an error.

**Two consequences the owner should know about, both deliberate.** A wallet funded only by a **gift card** has
no bank deposit and therefore no recorded depositor name, so it **cannot be withdrawn** until one deposit
settles — support can settle it by hand. And any deposit that settled **before migration 0012** is in the same
position. Neither strands anybody today, because the Paystack key is still in test mode and no real money has
ever entered a wallet. Refusing costs a support conversation; paying the wrong person cannot be undone.

**Verification.** `tsc` and `eslint` clean; **819 tests across 93 files** pass (was 785/92); `next build`
succeeds. The new control was **sabotage-proven four ways**, each confirmed applied by grep before the result
was trusted: disabling the route's refusal branch failed 4 tests; bypassing the comparison failed 12; dropping
`0012` from one fixture failed the new migration guard; and making the reference follow the editable profile
name failed the bypass proof first. Two of those failures were caused by the **test doubles**, not the code —
the logger mock omitted `warn`, so a refusal surfaced as a 500 — which is the same partial-`vi.mock` trap as
before, now commented in the fixture.

**Still owed by the owner at the time of writing:** "merge" for PRs #30 and #31, the diagnostics `curl` output
(which now also answers whether Paystack is test or live, i.e. item 4), and the disposable-inbox cost decision
(A absorb ≈₦540/inbox, B own a domain + inbound email for under ₦2/inbox — B is the better business case and it
is also what would make `emailVerifiedAt` real). The free inbox itself is still **not built**.

*(Both PRs were merged and promoted to production immediately afterwards — see the change log — and R52 below
supersedes the two open items that concerned the inbox and the probe.)*

**R52 — the free inbox is built, and email becomes freemium rather than free.**

The owner reversed part of R49 with a sharper model: *"the only free service should be the temp email, the other
email verification otp should cost money… users that cant afford to use the paid service can use temporary mail
with limited time."* That is a better shape than the one it replaces, because it gives the free tier a job —
being outgrown — instead of competing with the paid catalogue.

**The old four tiers still cannot simply come back.** They were removed for two reasons and only one of them was
the pricing argument. The other was technical and is unchanged: the supplier sells *an inbox* and no duration.
`FleexaEmailProduct` is `{id, name, domain, priceNgn, stock}`, so a "24-hour" and a "30-day" inbox are the same
purchase on their side. Selling four durations would have delivered one thing four times.

So the free/paid difference is **volume and history, not time** — we control both, the supplier controls neither.
The owner chose: **one free inbox per account per day**, **alive until discarded**, and a paid tier as **both a
single inbox and a bundle**. The consequence was stated plainly rather than left implicit: because a free inbox
lives until discarded, there is no time pressure to upgrade, so conversion rests entirely on wanting several
inboxes at once or wanting messages kept. That is a legitimate choice, but it is a different lever from the one
"limited time" implies, and the supplier's own `expiresAt` remains the real ceiling on both tiers.

**What was built.** Migration `0013_disposable_inboxes.sql` adds `disposable_inboxes` and `inbox_messages`; the
Drizzle schema, `src/lib/disposable-inbox.ts`, three routes (`POST /api/inbox`, `POST /api/inbox/poll`,
`POST /api/inbox/discard` plus `GET /api/inbox`), `/dashboard/inbox`, a nav entry under Manage, and the
explorer's `temporary-inbox` item now opens the real page instead of the marketing page.

**Two limits live in the database, not in application code**, because both are decided by two requests arriving
at once and creating an inbox spends real money the moment the supplier accepts it: a partial unique index gives
**one active free inbox per account**, scoped to `tier = 'free'` on purpose so a paid bundle of concurrent
inboxes stays possible without another migration; and a unique index on `daily_key` (`<userId>:<UTC date>`, NULL
for paid) makes **one free inbox per day** survive a race. The key is UTC so two instances cannot disagree about
which day it is and let one customer take two.

**Money safety, both directions.** The supplier is called *before* the row is written, because the address only
exists once it has accepted the purchase — so when our own index then refuses the row, we are holding an inbox we
paid for and cannot record, and it is cancelled rather than stranded. Discarding runs the other way round: the
supplier is cancelled *before* the row is marked discarded, because the opposite order lets a failed cancellation
leave a customer looking at a closed inbox that is still receiving mail somewhere they can no longer read. For a
verification code that is worse than an error. Both orderings are pinned by tests that record the call sequence.

**Cost and abuse controls.** A per-IP daily ceiling of three sits under the per-account cap, because the account
half of the defence is currently hollow: transactional email is not configured, so signup never verifies an
address and "signed-in users only" bounds nothing — anyone can register a hundred accounts. When the IP cannot be
determined the limiter degrades to keying by account rather than letting every unidentifiable caller share one
`unknown` bucket, which would lock the feature out for all of them. Polling is capped per account at twelve a
minute and the UI checks every fifteen seconds only while the tab is visible, because the supplier's request
budget is shared across every customer at once: one browser tab refreshing briskly could otherwise turn other
customers' purchases into 429s.

**Honesty in the copy.** `/email-otp` carried an amber "The inbox tool is not switched on yet" notice, which was
the right thing to render while nothing existed and would understate a shipped feature now, so it became a link to
the real page. The test that pinned that notice was replaced rather than deleted: it now asserts the page links to
`/dashboard/inbox`, does **not** say "not switched on yet", and does not promise retained history on the free
tier — giving that away would hand over the paid tier's only differentiator and then fail to deliver it. The
dashboard reports unavailability dynamically when the source is not configured, which is where that truth can
actually be told.

**Not built: the paid tier.** Its price has to be derived from the real per-inbox `priceNgn` through the existing
30–50% band, and the standing money rule is not to guess pricing. The probe is the thing that returns that
number, which is why R52's other half is the credential split in the commit before this one: diagnostics now
accepts its own `DIAGNOSTICS_SECRET` (set in Vercel as *sensitive*, so it is write-only and unreadable by
anyone) instead of borrowing `CRON_SECRET`, which also opens the auto-refund, scheduled-orders and wallet-email
crons. A read-only endpoint should not share a credential with jobs that move money, and rotating one should not
silently change the other.

**Verification.** `tsc`, `eslint` and `next build` all clean; **843 tests across 94 files**. Sabotage-proven three
ways, each confirmed applied by grep before the result was trusted: removing the compensation cancel failed 2
tests, moving the discard's cancel after the write failed the ordering test, and making the free tier retain
messages failed 1. Two of my own artefacts were caught by the gates rather than by me — an `EmptyState` action
that takes an `href`, not an `onClick`, and two synchronous `setState` calls in effect bodies that eslint's
`react-hooks/set-state-in-effect` rejected; the effects now subscribe to timers and bump a reload key instead,
which is the pattern `GiftCardsManager` already used.

**Still owed by the owner:** merge PRs #32 (docs) and #33 (this work), then the probe can be run without any
secret of theirs entering chat. After that the paid tier is a pricing exercise rather than a build: two plans,
their costs from `priceNgn`, and a `tier` the schema already carries.
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
| **39** | Per-feature real logo icons (PNG, brand gradient) — not generic SVG | 🟡 | ✅ `public/images/services/*` (12), `public/images/nav/*` (10 — every dashboard row, sidebar and mobile bar, now an image), categories (4), brand logo. ✅ platform logos (Facebook/Instagram/X/TikTok…) via real `BRAND_MARKS`. ⬜ provider logos (MTN/Glo/9mobile) still wordmark tiles — no redistributable mark exists in the CC0 sets (see `STATUS.md` §30.3). |
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
| 2026-10-27 | **Profit band + nav cleanup.** Every price is now derived from a supplier cost sheet (`data/cost-sheet.json` → `npm run pricing:build` → `prices.generated.ts`) at 30–50% markup on cost; volume discounts, promos and bulk tiers are all clamped to a 30% floor; ₦500 minimum order closes the Paystack-fee leak; `PRICING.md` documents the rule, the audit command and the three face-value exceptions (airtime, data, gift cards). Homepage nav lost the Services dropdown (Home, Pricing, Accounts, How it works, FAQ, Contact). 204 tests green. | #13, #24, #26 |
| 2026-10-27 | **Homepage rebuilt around the phone.** Hero reordered (copy+CTA → photo → proof), services heading corrected from "Four" to nine with dashboard-only cards routed through sign-in, 3-up desktop grid, subscriptions strip for the orphaned `/digital-services`, new accounts marketplace band (FB/IG/TikTok), full-width bento, dashboard section given a real visual, pricing teaser replaced with live pay-as-you-go prices (fake Plus/Business tiers gone), invented ratings/counts removed, marquee seam fixed, section ids, FAQ JSON-LD, real `og.png`, skip link, sticky CTA that hides behind the closing CTA. 219 tests green (14 homepage). | #16, #20, #26 |
| 2026-10-28 | **PR #16 — Stop telling customers the stock is supplied** (`4751ecd`). | #16 |
| 2026-10-29 | **PR #18 — Make fulfilment real, and close the money-safety and account-recovery gaps** (`2d6bdaf`). | — |
| 2026-10-29 | **PR #19 — Connect the deployed app to Aurora (RDS IAM), add a migration runner** (`5a82fc0`). Build command became `npm run db:migrate && npm run build`. **No `DATABASE_URL` is set anywhere:** the function assumes `AWS_ROLE_ARN` and mints a short-lived token via `@aws-sdk/rds-signer` (`useAwsIam = !databaseUrl && awsIamConfigured()`). A preview deployment created the schema — 11 of 11 migrations. | — |
| 2026-10-29 | **PR #20 — Verify email ownership, and require it for administrator access** (`3519601`). `isAdminUser` = verified address **AND** allowlisted address. ⚠ Consequence still live: with no mail provider `emailVerifiedAt` is never set, so `/admin` is unreachable — which blocks withdrawal approval and hand-prepared fulfilment. Escape hatch (not taken): a one-off migration marking the owner's account verified. Note `signup/route.ts:38` returns 403 for any `ADMIN_EMAILS` member, so `admin@pryva.com` cannot even register. | — |
| 2026-10-30 | **PR #21 — Stop claiming an email was sent when no mail provider is configured** (`9bbe88e`). | — |
| 2026-10-30 | **PR #22 — Fix fee-bearing Paystack top-ups; schedule crons, make verification reachable, document IAM vars** (`2ffb9da`). A ₦50,000 top-up was refused because both money-in paths compared Paystack's gross `amount` (5,086,295 kobo) instead of `requested_amount` (5,000,000) when "Pass fees to customers" is on. Their formula was reproduced exactly: `ceil((net_kobo + 10000) / 0.985)`. **The checks were not loosened** — `gross < requested` is explicitly rejected, and both branches now log expected *and* received. Crons live: `wallet-emails 10 3 * * *`, `auto-refund 40 3 * * *`. | #1–#3 |
| 2026-10-30 | **PR #23 — Panel-agnostic SMM boosting client; stop selling undeliverable plans on `/pricing`** (`c6c2e7b`). `smm-panel.ts` + `smm-catalog.ts`: listings only, `price` and `action` null so cards read "Ordering paused". `/pricing` CTA now gated on `isPlanFulfillable` — **10 plans orderable, 17 honestly refused** (verified live on production). Catalog route attempts each supplier independently and degrades rather than failing. | — |
| 2026-10-30 | **PR #24 — Bitcall gateway client and read-only eSIM catalog** (`0496001`). `bitcall.ts`: base URL pinned to `api.bitcall.io` (`BITCALL_API_URL` may redeploy but not re-host, because the secret rides as a header), `redirect:"error"`, nothing logs headers. eSIM catalog/orders/profiles, `getBitcallBalance()` on `GET /v1/balance`, and the full OTP client (services/countries/pools, buy/get/list activations, cancel/resend/reactivate). Added `isAmbiguousBitcallOutcome()`, which separates *"may I retry"* from *"did it possibly already happen"* — `SERVICE_UNAVAILABLE` is both retryable and ambiguous, `PRODUCT_UNAVAILABLE` is retryable and **not**; without that split a timeout followed by an automatic retry rents two numbers. Local rate budget moved to its own `LOCAL_RATE_BUDGET` code so "did my request leave this process" is answerable. **Inert at merge** (`BITCALL_KEY_ID` unset); the owner has since set it in Vercel. 760 tests. | — |
| 2026-10-30 | **PR #25 — Do not sell a hand-prepared item nobody can prepare** (merged `bd645fa`, head `cbb8215`). Purchasability is now per listing and decided server-side: `isManualFulfilmentReachable()` (fails closed), a `purchasable` field on `/api/accounts/listings`, a 503 **before** the wallet debit in the purchase route, and a banner explaining why *Prepared for you* items are paused. Found while adding a Google Voice account to the manual lane — see the sequencing warning at the top of this file. 766 tests; sabotage-proven three ways, including that removing only the server-side check while keeping the hidden button fails 2 tests. | — |
| 2026-10-30 | **PR #26 — Make an empty account feed explain itself** (merged `fac64ad`, heads `5581662` + `8ff5ca5`). Owner set `BULKACC_API_KEY` 14:28:40 and `FLEEXA_API_KEY` 14:31:00, both **after** the 14:10:09 production build — Vercel snapshots env at build time, so the running deployment's own `env` manifest contained neither. Rebuilt production (`dpl_BFn9uxSQQNihqPZNBamqtGQndn6Z`, PROMOTED, carries both). **⚠ `/status` then served stale HTML: plain `/status` still said "Not available" while `/status?cb=<random>` said "Available"** — always cache-bust when reading production, or you will diagnose a cache. So the account feed is confirmed live, yet `/api/accounts/categories` still returns only `Streaming`: connected, zero products. The reason was unrecoverable because this supplier reports a logical failure as HTTP 200 + `statusCode:200` + `data:null` (its documented insufficient-balance shape), so `readData()` did not throw, `items` became `[]`, and `primaryListings()` returned null on `!products.length` **logging nothing** — unfunded, rejected-key and empty-catalog were identical and silent. Added `probeCatalog()` (`not_configured`/`serving`/`no_products`/`failed`, keeps the message), a warn log on an empty page, and `GET /api/diagnostics/integrations` gated on the `CRON_SECRET` bearer (gated because it returns a feed's own wording and spends a rate-limited request; echoes only a key's last 4). Also `/accounts` had no `dynamic` export unlike 15 other pages, so its pause banner was frozen at build time and contradicted the listings API from the same deployment — now `ƒ`. 775 tests / 91 files, sabotage-proven three ways. **Most likely cause of zero products: the account has no balance.** Gift cards checked and need no feed: `createGiftCard()` debits the customer's own wallet and mints a `PRYVA-` code, so the earlier suspicion of hand-entered codes was wrong. **Verified live after merge** (production `dpl_8pc2DhSt7eFfNA2GJrAPkMXoXLyN`, PROMOTED): the global "purchases are temporarily paused" banner is gone from `/accounts`, so the page now reads configuration at request time; `/api/diagnostics/integrations` returns `{"error":"Unauthorized"}` without the secret; and — the first time this has been exercisable in production, because checkout was globally off until today and short-circuited before the per-listing logic — all six hand-prepared listings still report `purchasable:false` **with checkout enabled**, so PR #25's gate genuinely holds rather than merely passing tests. `/api/accounts/categories` still returns only `Streaming`: **the feed remains connected and empty**, which is now diagnosable rather than silent. | R43–R45 |
| 2026-10-30 | **PRs #27 + #28 merged** (`33506a1`, `e9fa62a`; production `dpl_3aFEr9M5JwbrF9TRyDv48LDp6Lj1`, PROMOTED). #27 recorded #26 here. #28 added per-feed probes to `/api/diagnostics/integrations` — `numbers.{balance,emailProducts,smsServices,rentAreas}` and `gateway.balance`, each an independent `probe()` so one unreachable catalogue cannot hide the others, samples capped at 5 rows, credentials echoed as their last four characters only. It exists because *configured* was being read as *working*: `isBitcallConfigured()` says nothing about whether a secret is 128-hex-shaped, which `bitcall.ts` rejects with `MALFORMED_SECRET` **before** any request is made. 779 tests, four sabotage-proofs (a fixture secret that was not 128 hex made two of them fail for the wrong reason — **read a client's own validation before stubbing a credential**). Verified live: the endpoint returns `{"error":"Unauthorized"}` without the secret. **Still needs the owner to run the `curl` with their own `CRON_SECRET`** — I will not read that value into chat, because the same secret authorises the refund and wallet-email crons. | R48 |
| 2026-10-30 | **Temporary email becomes free and stops being a product** (this branch, R49). Owner's business argument: a disposable inbox has thousands of free competitors, so nobody will pay for ours — and making email free must not make anything else free. Correct on both counts. The four paid tiers (`email-24/30/bundle/team`, ₦790–₦13,950) could never have sold *and* could never have been delivered, so they are removed from `catalog.ts`, `cost-sheet.json`, `prices.generated.ts` (41 → 37 plans, thinnest margin now ₦420 on `vn-ng`) and `SERVICE_TARGET_MARKUP` — not gated, gone. **⚠ The trap worth remembering:** `services` derives `fromPrice` from a service's plans but **falls back to the hand-set value when it has none**, so deleting the plans alone left ₦790 rendering in four places on the homepage, including the permanent phone sticky bar reading "Start with ₦790". `fromPrice` is now optional so TypeScript forces each consumer to choose what to render, and the bar says "Start free" — which is both true and a better opening than the cheapest paid plan. `/email-otp` rewritten: it had told visitors "nothing here can be ordered or charged" while rendering four priced cards with working `/signup?plan=email-*` buttons, and **no test covered that page's content at all**. Live feed inboxes in `fleexa-catalog.ts` now carry `price: null` — the supplier's per-inbox cost is an operating cost of a free feature and belongs in diagnostics, not a margin table — and the explorer keeps the `email` category populated with a `source:"tool"` item, the same shape bulk and scheduled orders use for things that are not priced. 784 tests / 92 files, sabotage-proven three ways: resurrecting ₦790 fails 3, dropping the tool item fails 2, re-adding a priced CTA fails 1. **The inbox itself is not built yet** — cost source and the paid smoke test are still the owner's calls; see R49. | R45, R49 |
| 2026-10-30 | **PR #29 merged** (`c95667a`; production `dpl_HC7aYoUoTN1gjGL2xUxwKLM3gtbz`, PROMOTED) and **verified live** with cache-busters: `/email-otp` is free with no price and no CTA; `/pricing` has **no Email OTP group at all**; `/status` no longer carries a temporary-email row (a free tool is not a purchasable category, and its row was derived from `plans`); the homepage reads "Free" in the picker, the service card and the price list; and the permanent phone sticky bar now says **"Start free"** instead of "Start with ₦790". No regression elsewhere — numbers still 10 of 12, marketplace checkout still Available. **Then found and fixed a second stale availability claim of the same class:** `src/app/(site)/page.tsx:1007` hardcoded the footer row `Number fulfillment: Paused`, so the busiest page on the site told visitors the core product was switched off while `/pricing` sold ten number plans with working "Get Started" links. Now derived from the same `isPlanFulfillable` allowlist `/status` uses → renders "Automatic · 10 of 12 plans", matching `/status` exactly. Safe at build time despite the page being prerendered, because the allowlist is a constant with no env and no network. **Why this class of bug hides:** a hardcoded availability claim goes stale in one direction only — it keeps saying "no" after the answer became "yes" — so it costs sales instead of causing a support complaint, and nobody reports it. `/status`'s "Digital subscriptions, gift cards…" row is still hardcoded and still wrong (gift cards work); it needs a *cached* signal, since `probeCatalog()` bypasses the 30-minute catalogue cache and must not run per pageview. 785 tests / 92 files; sabotage-proven (restoring "Paused" fails the new test). | R45, R49 |
| 2026-10-30 | **PRs #30 + #31 merged** (`3d7f787`, `230ff0d`; production `dpl_BPWzvm2sHdXPhrKkYh54ishk2ikZ`, PROMOTED). #30 made the homepage footer honest — `Number fulfillment: Paused` was a hardcoded literal while ten plans deliver automatically, and it is now derived from `isPlanFulfillable`, rendering **Automatic · 10 of 12 plans**. #31 removed the hero's decorative card dressed as a product screenshot, and shipped five more requests: password show/hide toggles on all six fields, an email-verification section in settings that surfaces `emailVerifiedAt` and links the one in-app resend path nothing previously reached, removal of the dashboard nav's promo card, diagnostics for why bank enrolment fails, and **the payout name rule (R51)** — `payment_topups.payer_name`, frozen by `completeTopUp` at settlement, is now the only reference a withdrawal may be paid against, so a profile rename cannot redirect money to a third party. 819 tests / 93 files, sabotage-proven four ways. **⚠ Infrastructure hazard found while verifying the deploy:** the production build logged `schema is up to date (13 migration(s) recorded)` rather than *applying 1 of 13* — because `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPORT`/`PGSSLMODE`/`AWS_ROLE_ARN` all target `development`, `preview` **and** `production` (an artefact of the Vercel RDS integration, which sets all three by default), and the build command ran `npm run db:migrate` unconditionally. **Every PR preview build was therefore applying its migrations to the production database before anyone reviewed or merged it.** Benign here — `0012` is additive and idempotent — but an unreviewed branch could have altered production schema. Fixed by gating the build command on `$VERCEL_ENV = production`; previews now build without touching the schema. Mitigating factors: `PAYSTACK_SECRET_KEY` and `CRON_SECRET` are production-only, so a preview cannot move money or fire a cron, and previews sit behind Vercel Authentication (`ssoProtection: all_except_custom_domains`). **Still open:** preview deployments continue to read and write production data at runtime; removing `preview` from the `PG*` targets would isolate them, but that changes how the owner tests, so it is their call. | R50, R51 |

| 2026-10-30 | **Every service shows its own icon** (this branch, R53). The owner reported the Email OTP page had no logo; the audit found that *no* service page had one — `/email-otp`, `/esim`, `/proxies`, `/virtual-numbers` and `/gift-cards` opened with a bare `<h1>`, and six dashboard sections did the same, while the cards leading to them showed artwork. Added `ServiceTitle` and put each service's own artwork in every hero and dashboard header. **Two silent wrong-logo fallbacks were the deeper find:** `ServiceIcon` carried `FALLBACK_IMAGE = "/images/services/virtual-numbers.png"`, so any unmapped key drew the *numbers* artwork instead of failing, and `NetworkBadge` ended with `return <BrandIcon brand="airtel" …>`, so any provider without a wordmark entry drew *Airtel's* logo — hidden only because exactly four providers exist. Both are now structural rather than patched: an unknown service gets a neutral named tile plus a development warning, `NETWORK_BRANDS` is an exhaustive `Record<AirtimeProvider, …>` that fails typecheck when a provider is added, and `ServiceIcon` gained `decorative` so a title row does not read the service name twice. **No logo was invented:** `siDisneyplus` does not exist and the CC0 `logos` set has no Disney icon, so Disney+, Outlook, MTN, Glo and 9mobile stay wordmark tiles, pinned by a test to exactly those five. `src/test/service-logos.test.tsx` (11 tests) locks all of it down; 953 tests / 107 files, typecheck, lint, build all clean. Full surface table in `STATUS.md` §17. | R53 |
| 2026-10-30 | **The homepage showed every service up to three times** (this branch, R54). Reported as services "occuring twice"; there were three repeats. The quick service picker re-rendered numbers, eSIM, proxies and Email OTP immediately above the nine-card grid; the price list re-rendered the same four with the same four `from` prices; and the accounts section carried Facebook/Instagram/TikTok/X chips while the marquee 40 px below carried the same marks. All three removed, and the section numbering fixed (`06 / Pricing` was followed by `08`, with nothing at 07). 1005 → 918 lines, 11 → 10 sections, 17 → 9 service artwork `<img>`s. Pinned by two new assertions in `homepage.test.tsx`: one `<img>` per artwork file (sabotage-proven) and eyebrows 01–07 with no gap. **Also measured, for the next pass:** `images.unoptimized: true` means the nine 3D icons ship **2,197 KB** to fill 32–64 px slots — resizing them to generated WebP derivatives is the biggest upgrade left on that page. 955 tests / 107 files. | R54 |
| 2026-10-30 | **Icons stop shipping at full size** (this branch, R55 = the "yes" to §18's assessment). `images.unoptimized: true` meant every icon was handed to the browser as a 512×512 master: **2,197 KB** of PNG to paint the home page's nine 20–64 px thumbnails. Added `scripts/build-service-artwork.mjs` (`npm run artwork:build`), which writes 64/128/192 px WebP derivatives (39 files, **71 KB** total) beside the masters, and `src/lib/service-artwork.ts` to build the `srcSet`. `ServiceIcon`/`CategoryIcon` now render a plain `<img>` with `sizes` — `next/image` cannot offer a `srcSet` with the optimiser off — keeping the PNG master as the fallback `src`. Nine homepage icons: 2,197 KB → **6 KB** at 64 px. Byte-level tests (sabotage-proven: removing `srcSet` fails). **Hero photo NOT done:** no egress to `images.pexels.com` from this sandbox (`SSL_ERROR_SYSCALL`), so the file cannot be copied in; the remote host therefore stays in `next.config.ts` and the CSP until the owner drops the original into `public/images/hero/` or authorises a generated replacement. 959 tests / 107 files. | R55 |
| 2026-10-30 | **The site on a phone** (this branch, R56). Reported as "user will have to adjust the screen zoom". Three causes, one fix each. (1) **369** separate `text-[0.5…0.79rem]` declarations across 72 files, down to **9.3 px**, replaced by two named steps — `text-micro`/`text-meta` — with a **13 px floor under `sm`**; desktop keeps the drawn sizes. (2) `.field` was `0.92rem` = 14.7 px and iOS Safari zooms the page on focus below 16 px, so controls are 16 px on phones — that one is a *browser behaviour*, not a taste issue. (3) Six tables sat in `overflow-hidden` wrappers and were **clipped**, not scrollable (admin orders/users/audit/reconciliation, cookie and refund policy) — now `overflow-x-auto` with a `min-w` each. Also: explicit `viewport` export (`width=device-width`, `initial-scale=1`, `viewport-fit=cover`, `colorScheme: light`) with **no** `maximum-scale`/`user-scalable: no`; `-webkit-text-size-adjust: 100%`; `overflow-x: clip` (not `hidden`, which breaks sticky); hero CTA rows wrap; the wallet's three money columns stack on a phone. `src/test/mobile-layout.test.tsx` (9 tests), sabotage-proven three ways. **Limit worth remembering:** no browser here — verified at source/CSS/served-HTML level only, not on a 360 px render. 968 tests / 108 files. | R56 |
| 2026-10-30 | **Gift cards leave the service categories** (this branch, R57). The owner is right that they are not a service: Pryva issues the code from the buyer's own wallet, so nothing is fulfilled and nothing is supplied. Removed from `serviceDefinitions` (homepage grid 9 → **8** cards), from `EXPLORER_CATEGORIES` and the explorer item, from the sidebar's Buy list (now a direct `/dashboard/gift-cards` link), and from the footer's Services column (moved beside Pricing). Terms copy separates the services from the gift-card product. **Everything that sells or redeems a card is untouched** — page, dashboard, routes, email, sitemap — and `gift-cards` stays in `ServiceSlug`/`service-timeouts`/pricing markup as an internal id so old orders still typecheck. One deliberate exception: `/status` still reports gift cards as Available, because that page reports deliverable *products*; the owner can delete the row. 969 tests / 108 files. | R57 |
| 2026-10-30 | **Self-hosted fonts + publisher structured data** (this branch, R58). The two `preconnect`s and the `fonts.googleapis.com` stylesheet in `<head>` were a render-blocking third-party request, and the only reason the CSP had to name Google's style and font hosts. `layout.tsx` now imports eight `@fontsource` cuts (Jakarta 300–800, Instrument Serif 400 + italic); files land in `/_next/static/media` with immutable caching, and `unicode-range` still gives the naira sign (U+20A6, latin-ext) the right face. CSP narrowed to `style-src 'self' 'unsafe-inline'` / `font-src 'self' data:`, with a test that fails if a Google `<link>` returns. Root layout also emits `Organization` + `WebSite` JSON-LD from `src/lib/structured-data.ts`, claiming nothing unprovable — no rating, review, address, phone or `sameAs`. 976 tests / 109 files. | R58 |
| 2026-10-30 | **Security, backups and the daily close** (this branch, R59). Six of the owner's seven asks. Signup refuses disposable inboxes (~150 providers, subdomain-matched, tested against a list of real providers it must not block); accounts lock for 30 minutes after 8 wrong passwords, atomically, cleared by sign-in or reset; terms rewritten to 15 dated clauses the product actually keeps; `npm run db:backup` / `db:restore` with per-table SHA-256, foreign-key-ordered restore, three refusals and a quarterly drill in RUNBOOK §8a; `SECURITY.md` (threat model, controls by file, known gaps, operator checklist) after finding that **admins were not required to have 2FA** (now enforced on pages and APIs) and a reachable `zod` advisory (pinned, `npm audit --omit=dev` clean, CI gate added); `/admin/transactions` ledger plus a nightly close that checks the ledger invariant per account and writes a `reconciliation_runs` row per day, with the three cron tasks merged into one job to stay inside the Hobby plan's two entries. Social links left open: the accounts do not exist yet, and a footer icon linking nowhere is worse than none. 1,067 tests / 117 files. | R59 |
| 2026-10-30 | **Social platforms in the footer, honestly labelled** (this branch, R59 continued). X and TikTok render with the real extracted brand marks; the profiles do not exist yet, so `profileUrl` is `null` and each link falls back to the platform's home page with the label "Pryva on X — profile coming soon" (tooltip and screen reader). `src/lib/social.ts` is the single switch: set `profileUrl` and the placeholder becomes a real link, no other edit. Links open in a new tab with `rel="noopener noreferrer"`. 1,067 tests / 117 files. | R59 |
| 2026-10-30 | **Security folded into settings** (this branch, R60). The owner: security "can't be separate" from settings. `/dashboard/settings` now carries the whole account in one scroll — the `?require=2fa` explanation, profile and password, then a `#security` section holding the two-factor card, the sessions card and the guidance that used to sit alone on its own page. The two cards moved with `git mv`, so there is one implementation of each. `/dashboard/security` is a redirect that **carries the query string and the anchor**, which is what keeps the admin 2FA bounce (`?require=2fa&next=…`) intelligible; the sidebar loses the Security row, the command palette points at the section, terms links to the anchor. New `src/test/settings-security.test.tsx` (7) pins all of it and `src/test/legacy-redirects.test.ts` (4) tests the query forwarding directly — `curl` cannot, because middleware answers `/dashboard/*` for signed-out visitors; three older tests that encoded the two-page layout were rewritten. 1,078 tests / 119 files. | R60 |
| 2026-10-30 | **Support that answers, and an assistant with hands** (this branch, R61 — the owner: "fix the support system, and I want AI support that will have engine and brain to think… every solution shouldn't come from admin only"). The contact form and a status dropdown became real threads (`support_tickets` + `support_messages`, migration `0019`): a customer writes, and the first reply comes from an assistant in the same request. `src/lib/ai-support/engine.ts` is the thinking — read the message, gather the account, score every explanation with its evidence, then act / ask one question / hand to a person, run the remedy, **re-read the account to check the fix landed**, and record every step. `knowledge.ts` is the brain: thirteen playbooks plus an honest "I don't recognise this", each with symptoms, corroborating facts, the reply, what it can do and when a person must take over. It can actually fix three things: re-check a deposit with Paystack and credit it if confirmed (moving those checks into `src/lib/topup-reconciliation.ts` so the browser-return route and the assistant share **one** opinion — that route's 52 tests pass unchanged), send a fresh verification link, and stop one of the customer's own schedules. It cannot move money out, refund, approve a withdrawal, unlock an account or switch off 2FA, and a test fails if the actions module ever imports a wallet, refund or payout function. Escalated tickets carry the whole trail to `/admin/support`, which sorts by least-confident-first; the customer's thread shows the reply and never the trace. A model may re-word a decided reply only, off by default, never on an escalation, never given the account. 1,120 tests / 123 files. | R61 |
| 2026-10-31 | **Google below the form, and passkeys** (this branch, R62 — the owner: "can you put the google login below the sign in and also add passkey login"). Two changes to the same screen. (1) `/login` and `/signup` now lead with the email and password form; the divider ("or sign in with" / "or sign up with") and then the alternatives follow it, so "Continue with Google" is the second offer rather than the headline. The anchor keeps its `href` and its text and gains Google's own four-colour G before the label, from the shared `BRAND_MARKS` table rather than a redrawn or generated mark — `logo-removal.test.tsx` pins both the absence of `pryva-mark` and the four Google fill colours, because a layout change is not a licence to rewrite what a test protects. (2) Passkeys (WebAuthn): a signed-in customer enrols up to ten in `#security` inside `/dashboard/settings`, and signs in from `/login` with no email, password or code. Migration `0020` adds `webauthn_credentials` (public key only — base64url COSE text, counter, transports, device type, synced, label, last used) and `webauthn_challenges`. The challenge is server-side, purpose-scoped (`register` / `authenticate`), five-minute TTL, and spent by a conditional `UPDATE … WHERE consumed_at IS NULL`, so a captured assertion cannot be replayed and a registration challenge cannot become a sign-in. The relying party is pinned by `WEBAUTHN_ORIGIN` → `NEXT_PUBLIC_SITE_URL` → the request origin (HTTPS or localhost only), with `WEBAUTHN_RP_ID` required to be a suffix; when that is unsatisfiable the routes 503 and the UI hides the control. Sign-in is username-less (`allowCredentials` empty), `userVerification: "required"` everywhere, a passkey satisfies the second factor without exempting anyone from lockout, a counter that goes backwards is refused and logged as a possible clone, and every failure is one generic 401. The browser half is hand-written (`src/lib/webauthn-browser.ts`) so the sign-in screen loads no third-party bundle. New `passkeys.test.ts` (19, PGlite + mocked verifier) and `passkey-ui.test.tsx` (18). 1,157 tests / 125 files. | R62 |
| 2026-10-31 | **Refer a friend** (this branch, R63 — the owner asked what else to build, chose referrals, and approved "5% of the first order, capped at ₦2,000"). `referral_codes` mints one code per account on first use; `referrals` records the attribution and the payout, with `referee_id` UNIQUE (one reward per invited account) and a UNIQUE ledger reference (one payout per referral). Signup and Google signup both read `?ref=` from the body or the 30-day `pryva_ref` cookie, so a detour through Google still attributes. A reward is paid when the invited account's **first delivered** order exists (`status IN (active, delivered)` and not refunded) — claimed by a conditional update and credited in the same transaction through `creditWalletInTx` (new, so the reason and the money commit together). The purchase path settles immediately; the nightly job sweeps the hand-fulfilled cases; neither can fail a purchase. Self-referrals are refused in code **and** by a CHECK constraint, the inviter sees `b•••@example.com` rather than an address, and the reward is wallet credit — never a withdrawal. Rate and cap live in `REFERRAL_REWARD_PERCENT` / `REFERRAL_REWARD_CAP_NGN` (0 turns it off); terms §4 now says the same thing. New `/dashboard/referrals` + `/api/referrals`, "Refer & earn" in the sidebar, `referrals.test.ts` (24) and `referrals-ui.test.tsx` (11). 1,192 tests / 127 files. | R63 |
| 2026-10-31 | **A profile picture** (this branch, R67 — the owner: "can you add 3d icon image for profile picture too"). The sidebar drew initials in a gradient circle; there is no upload, so the account now gets one of four 3D avatar masters (`public/images/avatars/`, 64/128/192 WebP) chosen deterministically from the email — stable on navigation, identical on server and client, different between accounts, and a featureless silhouette rather than an invented face. Shown in the sidebar footer and at the head of the settings Profile section. `profile-avatar.test.tsx` (6). 1,256 tests / 132 files. | R67 |
| 2026-10-31 | **Real images on every dashboard row** (this branch, R66 — the owner: "i am talking about real images icon that's missing"). The R65 pass fixed which services the sidebar lists but left **ten rows with no image at all**: Overview, Orders, Wallet, Temporary inbox, Refer & earn, All services, Notifications, Reviews, Settings and Support still drew stroked 16 px SVGs, and the mobile tab bar was all glyphs. Added ten 512 px masters in `public/images/nav` in the same 3D set as the service tiles, with 64/128/192 WebP derivatives (`npm run artwork:build` now walks the nav folder), and a `NavIcon` component used by both the sidebar and the five mobile tabs. Live check: 22/22 sidebar links render an `<img>`, zero glyphs. `dashboard-nav-coverage.test.tsx` (9) parses both `<nav>` blocks and fails on any glyph. 1,250 tests / 131 files. | R66 |
| 2026-10-31 | **The dashboard's missing marks** (this branch, R65 — the owner: "can you check what icon logo is missing and what service is missing on the user dashboard"). Audited the rendered sidebar while signed in: App verification and Social promotion were the only Buy rows with no mark (generic phone and people glyphs), Subscriptions borrowed the Digital Accounts artwork — the same 3D tile for two destinations — and `/dashboard/reviews` existed with no link to it anywhere in the app. Added three 512 px masters in the existing 3D set (`subscriptions`, `app-verification`, `social-promotion`) with 64/128/192 WebP derivatives, extended `ServiceIcon`'s exhaustive map, gave every Buy row its own artwork, and put **Reviews** under *You*. Gift cards remain outside the hub categories by the owner's earlier rule. `dashboard-nav-coverage.test.tsx` (6). 1,247 tests / 131 files. | R65 |
| 2026-10-31 | **Fraud controls** (this branch, R64 — the owner: "can you strict fraud on my platform"). Three layers. (1) **Signals**: `account_signals` stores where an account was created from as salted SHA-256 hashes (`FRAUD_HASH_SALT`), never the raw address — enough to ask "same network?" and useless as a location history. (2) **Assessment**: a withdrawal is scored against facts already in the database (account under three days old, payout account added in the last 24h, this account has never been paid, request is almost the whole deposit history, 3+ requests in 24h, >3 accounts on this network); the result lands in `withdrawals.risk_level` / `risk_reasons` and in the admin queue, and **blocks nothing** — the approval flow is untouched, so a false positive costs a badge rather than a refusal. (3) **Ceilings**: 40 purchases per hour and 10 gift-card redemptions per day per account, counted from the database because an in-memory counter is per-instance; both answer 429 and log the event. Referral settlement now voids a reward between two accounts created on the same network, and a missing signal never blocks a genuine one. New `/admin/security` **Fraud signals** queue (admin-only, same-origin, advisory, the only write is `fraud.review` into the audit log). `fraud.test.ts` (19) and `fraud-ui.test.tsx` (9). A second pass adds operator email alerts for `high` signals, each in the shared branded shell with its own 3D shield hero (`hero-fraud.jpg`), one per account and signal per 30 minutes, sent after the row commits with a timeout and failures swallowed so mail can never fail a money path; recipients are `FRAUD_ALERT_EMAIL` falling back to `ADMIN_EMAILS`. `fraud-alerts.test.ts` (21). 1,241 tests / 130 files. | R64 |

---

### HOW TO USE THIS FILE (for me, in future sessions)

1. Read this file **before** touching code.
2. Re-verify any ✅ with a file read — do not trust this table blindly.
3. Pick the lowest-numbered ⬜/🟡 item that you've confirmed.
4. When done: flip the status, add one line to §8, commit.
