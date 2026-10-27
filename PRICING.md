# Pricing & margin policy

**The rule: every product is sold at 30–50% markup on the supplier's fixed cost.**
No price anywhere in Pryva is typed by hand. Prices are computed from costs, so
the margin cannot drift out of the band when a supplier raises their price, the
Naira moves, or someone edits a page and types "₦1,200" by reflex.

```
cost ₦1,000  →  price ₦1,300 … ₦1,500          (30–50% markup on cost)
```

Both views are reported, because "40% profit" means different things to
different people:

| | formula | on a ₦1,000 cost sold at ₦1,400 |
|---|---|---|
| Markup on cost (the band) | (price − cost) / cost | **40%** |
| Gross margin on price (accounting) | (price − cost) / price | 28.6% |

The band is defined as **markup on cost** — profit as a share of what we paid —
because that is what "I make 40% on this" means to a reseller, and it is the
conservative reading: a 30% markup is always a bigger naira profit than a 30%
gross margin.

---

## 1. Where prices come from

```
data/supplier-costs.json          ← the only file an owner edits
        │
        ▼  npm run pricing:build
src/lib/pricing.ts                ← the rule (band, rounding, floors)
        │
        ▼
src/lib/prices.generated.ts       ← price + maxDiscountPercent per plan (no costs)
        │
        ▼
src/lib/catalog.ts · src/lib/digital-services.ts · src/lib/marketplace-pricing.ts
```

### Editing a cost

1. Open `data/supplier-costs.json` and change the `cost` for that plan (naira,
   integer — this is what the supplier charges *us*, per unit).
2. Run `npm run pricing:build`.
3. Commit both files. `npm run pricing:audit` prints the whole margin table.

```bash
npm run pricing:build    # regenerate prices (fails loudly if any price leaves the band)
npm run pricing:audit    # print the cost → price → profit table, change nothing
```

If you forget step 2, `npm test` fails: a test recomputes every price from the
cost sheet and compares it with the generated file, so a stale price cannot ship.

### Why the generated file exists

`src/lib/catalog.ts` is imported by client components, so everything in it ships
to the browser. Supplier costs are our buying prices — publishing them publishes
our margin — so costs stay in `data/supplier-costs.json`, and only the finished
`price` (plus `maxDiscountPercent`) is baked into the app. A test asserts the
generated file contains no cost field, and no component can see one.

---

## 2. Target markup by service

Within the band, each service has a target. Low-ticket items sit near the top:
a ₦800 virtual number has to absorb a payment fee, a refund risk and support, so
45% is not greed — it is what makes the order worth taking. High-ticket items sit
nearer the floor because customers price-check them instantly.

| service | target | why |
|---|---|---|
| Virtual numbers | 45% | smallest tickets, highest failure/refund rate |
| Email / OTP inboxes | 45% | same, short-lived products |
| Digital accounts (marketplace) | 40% + premium | 45–48% on Facebook/Instagram, 43–45% on X/TikTok |
| Subscriptions (Netflix, Spotify…) | 40% | price-checked against the platforms' own naira rates |
| eSIM | 35% | high ticket, compared with Airalo/Holat at checkout |
| Proxies | 35% | high ticket, sold in packs |
| Bulk orders / scheduled | 35% | volume business, thinner by design |
| Gift cards | face value | see exceptions below |

Tune with env vars (no deploy needed): `PRICING_MIN_MARKUP_PERCENT` (30),
`PRICING_TARGET_MARKUP_PERCENT` (40), `PRICING_MAX_MARKUP_PERCENT` (50).

Prices are rounded **up** to a step that fits the cost — ₦10 under ₦2,000, ₦50
above — so rounding can only add margin. On a ₦160 item a ₦50 step would be wider
than the whole band (₦200 is 25%, ₦250 is 56%), which is why the step scales.

---

## 3. Discounts may not breach the floor

Every discount path is clamped to 30% markup on cost:

| path | rule |
|---|---|
| Marketplace volume tiers (5/10/25 units → 5/8/10% off) | price is floored at cost × 1.30 after the discount |
| Provider promo codes | the discount is passed through, then the floor is re-applied to the reduced cost; an oversized code stops at the minimum chargeable order |
| Bulk orders (10+ / 20+ items → 5/10% off) | the basket caps its discount at the thinnest line's headroom (`maxDiscountPercent` per plan) |
| Category premiums (Facebook/Instagram etc.) | lift a category *inside* the band, never past 50% |

Concretely: a 45%-markup virtual number can absorb the full 10% basket discount
(30.5% left); a 35%-markup eSIM cannot, so the basket shows a smaller discount
("5% discount for 10+ items — 3% on this basket to keep every line profitable")
rather than selling below the floor. **A smaller discount is always the
resolution; never a thinner margin.**

**Minimum order: ₦500.** Paystack charges a flat ₦100 plus 1.5%, so a ₦120 order
clears the margin band but not the fee. Marketplace checkout refuses baskets
below ₦500 and says so, instead of losing money quietly.

---

## 4. Services that do not carry a 30–50% markup — and why

These are deliberately excluded. Raising them by 30–50% would either be illegal
or lose the customer instantly:

- **Airtime** — a ₦1,000 top-up is worth ₦1,000. Our margin is the reseller
  commission from the aggregator (typically 2–5%), and a markup above face value
  is not something any customer would pay.
- **Data plans** — same: bundles sell at the operators' published price; we earn
  the dealer discount, not a shelf markup.
- **Gift cards** — sold at face value by definition. The margin is the discount
  we buy them at (and they are strictly non-refundable — see `/refund-policy`).

Everything else — numbers, eSIM, proxies, email/OTP, digital accounts,
subscriptions, bulk, scheduled — is priced by the band. If a supplier ever quotes
us above the market rate for airtime/data/gift cards, the correct response is to
stop selling that SKU, not to break the band.

---

## 5. What the numbers look like today

From `npm run pricing:audit` (2026-10-27, placeholder costs pending the owner's
real supplier invoices — see §6):

| plan | cost | price | profit | markup |
|---|---|---|---|---|
| vn-ng (Nigeria number) | ₦920 | ₦1,340 | ₦420 | 45.7% |
| email-24 (1 inbox · 24h) | ₦540 | ₦790 | ₦250 | 46.3% |
| esim-ng-1 | ₦3,460 | ₦4,700 | ₦1,240 | 35.8% |
| proxy-ng-25 | ₦50,000 | ₦67,500 | ₦17,500 | 35.0% |
| netflix-1month | ₦2,690 | ₦3,800 | ₦1,110 | 41.3% |
| spotify-1month | ₦1,540 | ₦2,160 | ₦620 | 40.3% |

41 plans · thinnest margin ₦250 · every price inside the band.

---

## 6. Open item: the real supplier costs

The costs in `data/supplier-costs.json` are **placeholders**: each was seeded as
"the price we were already charging, divided by 1.3" — the most conservative
reading of the old hand-typed prices. They keep the catalogue in a sane place,
but they are not invoices.

To make the margins real, replace each `cost` with what the supplier actually
charges per unit, then run `npm run pricing:build`. Two sources:

- **Marketplace listings** (accounts, and anything else from the supplier API):
  no manual work — the live `price` from the listing × the live FX rate feeds
  `marketplace-pricing.ts`, which applies the same band at request time.
- **Own catalogue** (numbers, eSIM, proxies, email/OTP, subscriptions): the cost
  sheet. Ask the supplier for their per-unit price list, paste it in, rebuild.
