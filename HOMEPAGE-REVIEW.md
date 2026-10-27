# Homepage review — layout, positions, and what's missing

Reviewed against the live dev server (`http://0.0.0.0:3000/`) and the source.
Sections 1–4 are the "tell me first" findings; §0 records the decisions you made
and what shipped in this pass.

> Note on method: there is no browser in this sandbox, so I audited the rendered
> HTML/DOM plus every layout class, rather than eyeballing screenshots. The
> structural problems below are all visible in the markup and CSS; the ones that
> need a pixel decision are marked **(visual call)**.

---


## 0. Decisions taken (and shipped)

| Question | Decision |
|---|---|
| Services grid | **All nine as cards**; the four dashboard-only ones say "In your dashboard — sign in to buy" and route through `/login?next=…` instead of bouncing a guest off a redirect |
| Pricing teaser | **Replaced with real pay-as-you-go prices** — Plus/Business tiers removed (no billing exists), no "illustrative" caveat |
| Social proof | **Quotes kept, invented numbers removed** — no 4.9/5, no "4,200+ delivered", no stock avatars (initials instead) |
| Hero on phones | **Photo moved directly under the CTA**, benefit chips and the trust line below it |

Everything in sections 1–4 below shipped in this pass, except the two items
noted as open at the end.

### What changed

- Hero photo has **one** overlay instead of two: the "Example order · Lagos"
  pill is gone, the live-code card keeps "Live verification · Delivered in 9s",
  and the timer sits at the bottom with the WhatsApp mark beside it.
- Hero rebuilt as three ordered blocks (copy+CTA → photo → proof) so on a phone the
  CTA and the product shot both land above the fold; desktop stays two columns via
  explicit grid placement.
- Services: heading now true ("Every service. One quiet dashboard."), 3-up grid on
  desktop, lighter cards, dashboard services flagged, and a **subscriptions strip**
  linking the previously orphaned `/digital-services`.
- New **accounts marketplace band** (Facebook / Instagram / TikTok / X) with a
  real from-price and a straight link to `/accounts`.
- Bento is full-width now (heading above, cards below), so cards get ~380px instead
  of ~190px on desktop.
- Dashboard section has an honest right-hand visual: a live-code card, the
  auto-refund line and the wallet row — real states the product renders.
- Marquee rebuilt as two equal halves (seam gone) with the duplicate copy hidden
  from screen readers.
- Pricing section lists the four live entry prices + "no monthly fee" facts.
- Testimonials keep the quotes; initials replace stock portraits; the rating row
  and delivery counter are gone.
- FAQ got `FAQPage` JSON-LD; sections got ids (`#services`, `#accounts`,
  `#pricing`, `#faq`, `#final-cta`).
- New `og.png` (1200×630) generated from the catalogue prices, wired into both the
  root and homepage metadata.
- Skip-to-content link in the site layout.
- Sticky phone CTA extracted to `StickyMobileCta` and now hides itself while the
  closing CTA is on screen.
- Consistent vertical rhythm: every major section `py-16 sm:py-24`.
- Footer's Services column routes dashboard services through sign-in and adds
  "Streaming & subscriptions".
- Four H2s no longer glue words together at their line breaks.

Verification: `typecheck` 0 errors · **219 tests green** (14 new homepage tests) ·
`next build` clean · `/`, `/og.png`, `/login?next=…`, `/accounts`,
`/digital-services`, `/pricing` and the four service pages all 200.

### Still open

1. **The hero photo and its `next/image` rule still point at `images.pexels.com`.**
   This sandbox has no network route to Pexels, so the file could not be
   downloaded into `public/`. In production it works, but the homepage depends on
   a third-party CDN — worth localising when you have a copy of the source photo.
2. **Testimonials are still unverifiable quotes.** They are now free of invented
   numbers, but if you have real customer words (or consent to name people), those
   should replace them.

---

## 1. What the page was before this pass (snapshot)

| # | Section | Padding | Width behaviour |
|---|---|---|---|
| 1 | Hero — badge, H1, paragraph, 2 CTAs, 3 checks, rating row, then photo card | `pt-5 pb-10` / `sm:pt-12 pb-16` | 1 col ≤lg, `1.03fr / 0.97fr` at lg |
| 2 | Quick picker — 4 price cards | `pb-6` | 1 col mobile, 2 at sm, 4 at lg |
| 3 | Platform marquee — 17 brand pills, doubled for the loop | `py-5` | full bleed |
| 4 | Services — "Four services…" + card grid | `py-14` / `sm:py-24` | snap rail mobile → **2 columns, still 2 at desktop** |
| 5 | Feature bento — "Why Pryva" | `py-6` / `sm:py-10` | 0.9/1.1 split at lg, 6-col grid *inside the right half* |
| 6 | Dashboard — text panel, 4 bullets | `py-14` / `sm:py-24` | panel full width, copy capped at `max-w-3xl` |
| 7 | How it works — 4 steps | `py-8` / `sm:py-12` | 1 / 2 / 4 columns |
| 8 | Pricing teaser — 3 tiers | `py-14` / `sm:py-24` | 1 / 3 columns |
| 9 | Testimonials — 3 quotes | `py-6` / `sm:py-10` | 1 / 3 columns |
| 10 | FAQ — sticky intro + accordion | `py-14` / `sm:py-24` | 1 / 0.8fr + 1.2fr |
| 11 | Closing CTA — dark panel | `pb-6` | 1 / 1.15fr + 0.85fr |
| 12 | Sticky mobile CTA + 80px spacer | — | phones/tablet only |

---

## 2. Position / layout problems

**A. The services grid is 2 columns at every width — including 1440px.**
`page.tsx:498` has `sm:grid-cols-2` and no `lg:` override. Nine cards, each with a
1.4rem title, a two-line description, four tags, a price line and a "Popular: …"
line, means **five rows of ~570px-wide cards** on a desktop. The section alone is
roughly 3 phone-screens tall and reads like a spreadsheet. This is the single
biggest reason the page feels "off".

**B. The bento is squeezed into 55% of the width and then split six ways.**
`page.tsx:565` gives the cards the narrow half of a `0.9fr / 1.1fr` split, and
inside that `md:grid-cols-6` (spans of 3/3/2/2/2). At lg each small card is
~190px wide, so a sentence like "Fund your wallet with a Nigerian bank transfer
or card" wraps into six cramped lines next to a 96px-wide title area. On phones
it is one column of full-width cards — the layout gets *worse* as the screen
gets bigger, which is the opposite of what you asked for.

**C. The dashboard panel is half empty.**
`page.tsx:628` caps the copy at `max-w-3xl` inside a full-bleed gradient panel
(≈1200px). Since the mockup was removed, the right ~40% of a `rounded-[2.25rem]`
panel is plain gradient. It reads as a section where an image failed to load.

**D. Vertical rhythm is inconsistent.**
Sections alternate 96px padding (`py-14 sm:py-24`) with 40px (`py-6 sm:py-10`)
and 48px (`py-8 sm:py-12`). Concretely: Pricing (96px) → Testimonials (40px) →
FAQ (96px) makes the testimonials look pinched between two big blocks, while
Services → Bento has 96px above and 40px below. There is no rhythm a designer
would have chosen; it is an accumulation of edits.

**E. The marquee visibly jumps at the loop point.**
`page.tsx:453` uses `flex … gap-3` and `translateX(-50%)` (`globals.css:225`).
With a gap, half the track is not the start of the duplicate copy (the gaps count
`2n−1` times), so every 38s the strip snaps ~12px. Fix: put the gap inside each
half, or animate by `calc(-50% - 6px)`.

**F. On a phone the hero photo starts ~600px down — below the fold.**
Order is badge → H1 (3–4 lines at `clamp(2rem, 8.2vw, …)`) → paragraph → two
full-width buttons → three benefit chips → avatars/rating → *then* the image.
The one asset that sells the product is invisible until the user scrolls, and
the sticky bottom bar repeats the same CTA that is already on screen. **(visual call)**

**G. "Four services" — but nine cards render.**
`page.tsx:476` says *Four services. One quiet dashboard.*; the grid maps
`services`, which has nine slugs. A visitor counting cards notices immediately.

**H. Four of those nine cards are dead ends for a signed-out visitor.**
`data`, `gift-cards`, `bulk` and `scheduled` link to `/dashboard/*`
(`catalog.ts:304,350,396,442`). Clicking "Data Plans" as a guest bounces to
`/login` with no explanation. The footer's Services column repeats the same four
dead links on **every page of the site**.

**I. Four H2s lose the space at their line break.**
`Built for how<br /><span>Nigeria…` renders as "howNigeria" in the DOM, and the
same happens to "peopleask", "bought,still" and "verificationcan". It looks fine
on screen (it's a line break) but search snippets and screen readers get the
glued words.

**J. Quick-picker prices read `plansFor(slug)[0]`, not the cheapest plan.**
`page.tsx:44–72`. It happens to match today (the first plan is also the cheapest);
the moment someone reorders the catalogue, the "From ₦X" becomes a lie. Should
use `service.fromPrice`, which the pricing work now guarantees.

---

## 3. What's missing from the homepage

**Product coverage**

1. **The account marketplace has no show.** Facebook / Instagram / TikTok
   accounts are the flagship supplier category, and they get one generic
   "Digital Accounts" card. AUDIT U6 (Facebook/Instagram showcase) is still open.
2. **`/digital-services` is orphaned.** Netflix, Spotify, ChatGPT, Canva,
   Disney+, YouTube — real, priced, public page — is linked from *nowhere*: not
   the homepage, not the nav, not the footer. Fourteen priced plans nobody can find.
3. The hero paragraph still lists only "numbers, eSIM, proxies and temporary
   inboxes" — it omits accounts, subscriptions, data, gift cards, which the page
   then sells further down.

**Trust & conversion**

4. **No Open Graph image.** `src/app/layout.tsx:23` has `openGraph` with no
   `images`, and `public/` has no `og*` file. Sharing a Pryva link on WhatsApp or
   X shows a bare text link. The site-wide OG title is also "Pryva — Simple.
   Secure. Scalable." while the homepage's own title is different.
5. **No payment reassurance near the CTAs.** Paystack is mentioned only as a
   footer badge; there is no "secured by Paystack · Naira only · refund policy"
   line beside the signup buttons where the hesitation actually happens.
6. **No support entry above the FAQ.** The only support link is a ghost button
   at the bottom of the FAQ column. There is no WhatsApp/email line despite
   "account manager on WhatsApp" being sold in the Business tier.
7. **No structured data.** The FAQ block is perfect for `FAQPage` JSON-LD and the
   brand for `Organization`/`WebSite` — free rich results, currently absent.
8. **The social proof is invented.** "4.9/5", "4,200+ numbers delivered", three
   testimonials with stock Pexels portraits and Nigerian names, and a hero card
   reading "Adaeze · Surulere — verified in 9s". It is the same category of thing
   as the dashboard mockup you had me delete. Either these are real numbers you
   have, or they should go.

**Assets & resilience**

9. **The hero photo and avatars hotlink `images.pexels.com`.** The most important
   screen in the product depends on a third-party CDN and a `next.config` rule
   (`remotePatterns`); if Pexels rotates an ID the hero breaks. They should be
   downloaded into `public/images/hero/` and served through the image optimizer.
10. **No skip-to-content link** and no `id` anchors on sections, so `#services`,
    `#pricing`, `#faq` cannot be linked to.

---

## 4. What I'd do (proposed order, mobile-first)

1. **Hero** — badge → H1 → one-line sub → primary + secondary CTA → **photo card
   with the live-code overlay** → then the three benefit chips and rating row
   below the image. On phones the CTA and the product shot both land above the
   fold; desktop stays two columns.
2. **Quick picker** — keep, but prices come from `service.fromPrice`.
3. **Services (rebuilt)** — six buyer-facing services in a 3-up grid on desktop
   (numbers, eSIM, proxies, email OTP, accounts, subscriptions); the four
   app-only services become a slim row of "in your dashboard" chips that say so,
   instead of cards that silently bounce to `/login`. Heading becomes true
   ("Everything you need to get verified — one wallet").
4. **Marketplace band (new)** — "Buy aged Facebook, Instagram and TikTok
   accounts — credentials in seconds", with the three real brand marks, a from-price
   and a link to `/accounts`.
5. **Platform marquee** — keep, moved below the marketplace band, seam fixed.
6. **Why Pryva bento** — full width, 4 cards, 2×2 on tablet/desktop, no squeeze.
7. **Dashboard section** — keep the copy, fill the empty half with an honest
   visual: a live-code card + a refund timeline (both real product states), not a
   fake screenshot.
8. **How it works** — unchanged.
9. **Pricing teaser** — replace the three subscription tiers (no billing exists
   in the product today) with the real pay-as-you-go facts: four from-prices, "no
   monthly fee", "wallet top-ups from ₦1,000", plus a link to `/pricing`. If you
   do want to sell Plus/Business, they need checkout before they can sit here.
10. **Testimonials** — keep the three quotes, drop the numbers we cannot defend.
11. **FAQ** — unchanged, plus FAQPage JSON-LD.
12. **Closing CTA** — unchanged, plus the "secured by Paystack · refund policy"
    line.
13. **Sticky mobile CTA** — hide it while the closing CTA is on screen so it
    never covers the final call to action.

Plus the mechanical fixes: spacing rhythm (one scale: 64/96px mobile, 96/128px
desktop), H2 word spacing, `id` anchors, OG image, local hero assets,
skip-link, and deleting the unused `serviceIcons` map.

**Verification I'd run:** `typecheck` → `test` (I'd add assertions: no
`/dashboard/*` hrefs in the signed-out homepage, six service cards plus four
app chips, one `<h1>`, OG image present, every service `href` resolves 200) →
`build` → live check of `/` plus the six service pages.

---

## 5. Decisions I need before touching it

1. **Services grid truth** — 6 public cards + 4 "in your dashboard" chips (my
   recommendation), or all 9 as cards with an explicit "opens in your dashboard
   → sign in" hint, or back to the original four?
2. **Pricing teaser** — replace the fake Plus/Business tiers with real
   pay-as-you-go prices (recommendation), keep them but label "coming soon", or
   drop the section entirely until billing exists?
3. **Social proof** — delete the invented "4.9/5" and "4,200+ delivered" and keep
   only the quotes, or do you have real numbers I should use instead?
4. **Hero on phones** — move the photo above the benefit chips (recommendation),
   or keep copy-first and just tighten the spacing?
