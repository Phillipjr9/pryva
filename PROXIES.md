# Proxies — what exists, and the one thing needed before they can be sold

Written 2 November 2026. Fleexa carries residential proxies, which matters because
Fleexa is already the supplier behind numbers, rentals and the temporary inbox — the
same key, the same rate-limit budget, the same envelope. So the proxy family needs no
new provider relationship. It needs an endpoint, and as of today there isn't one:
the supplier sells proxies in its dashboard and publishes no API for them.

## What is already built

| Piece | File | State |
|---|---|---|
| Supplier client (products, buy, usage, cancel) | `src/lib/fleexa.ts` (`Proxy` section) | Written; **family absent from the published API** |
| Plan → gigabytes/days/region | `src/lib/proxy-plans.ts` | Done, and pinned against the catalogue by test |
| Plan → supplier product id | `FLEEXA_PROXY_PRODUCTS` (JSON, deployment data) | You map it; no ids are guessed in code |
| On/off switch | `FLEEXA_PROXY_ENABLED=1` + key + map | Off unless all three are present |
| Read-only supplier probe | `/api/diagnostics/integrations` → `proxies` | Done — reads products, cannot spend |
| Purchase route | — | **Not written, deliberately** (see below) |
| Order page (credentials + used GB) | — | Not written |

## Why there is no checkout yet

Two findings, the second of which matters more than the first.

**1. The endpoints are a guess.** They follow the supplier's own naming convention
(`/sms4/buy`, `/email/buy`, `/rent/sms4/buy` → `/proxy/products`, `/proxy/buy`,
`/proxy/check/:id`, `/proxy/cancel`). That is evidence of a house style, not a
contract.

**2. The supplier's published API does not include proxies at all.** Checked on
2 November 2026 against `fleexa.com.ng/api`, `fleexa.com.ng/docs` and
`fleexa.com.ng/llms.txt`. The endpoint list is complete and explicit:

```
SMS OTP    /sms4/*, /sms5/*, /sms6/*
Email OTP  /email/*
Rentals    /rent/*
eSIM       /esim/*
Account    /profile, /balance
```

No `/proxy/*`. The docs page describes "four core services"; the marketing
homepage does list proxies under "REST API", and the proxies landing page points
developers at API docs that never mention them. The honest reading: **proxies are
sold in the supplier's dashboard and are not exposed to API customers.** A smoke
test would most likely return 404 — not because the key or the path is wrong, but
because the family is not open.

That is why nothing is wired to money. Debit-then-404 is exactly the failure this
codebase refuses.

## What that leaves

The block is a supplier-side answer, not our code. In preference order:

1. **Ask whether proxy ordering is available over the API** — `t.me/fleexasupport`
   or `hello@fleexa.com.ng`. One question: *"Do you expose residential proxy
   purchases through the /developer API, and if so what are the endpoints?"* If
   yes, `src/lib/fleexa.ts` is already shaped to receive it.
2. **Manual fulfilment** — sell the plan, then have an operator buy and hand over
   the credentials through `/admin/fulfilment`. Works today with no API; not
   instant; no current copy promises instant proxy delivery, so it stays truthful.
3. **A proxy-native provider** — then the map in `src/lib/proxy-plans.ts` changes,
   not the design.

## A second thing worth knowing: price

The supplier's public starting price for residential proxies is **₦500/GB**
(`llms.txt`: "Residential Proxies | ₦500/GB"). Our cost sheet assumes **₦2,690/GB**
for the smallest Nigeria plan and ₦2,000/GB at the 25GB tier. If ₦500/GB is real
for the product we would resell, our quoted cost sits above the supplier's own
retail, and every proxy margin in `PRICING.md` is fiction.

Selling prices are the owner's call and are unchanged. But the *cost* column needs
a real quote before any proxy plan is sold, or the profit figure shown on the
comparison page is a number we invented.

## If the family turns out to be open

With `FLEEXA_API_KEY` set (nothing else):

```sh
curl -s -H "Authorization: Bearer $DIAGNOSTICS_SECRET" \
  "https://<your-domain>/api/diagnostics/integrations" | jq .proxies
```

- `products.count` above zero: the family exists and the `sample` shows its field
  names.
- `products.ok: false` with 404: consistent with the published list above — stop
  and take path 1 or 2.
- `mappedPlans` counts what `FLEEXA_PROXY_PRODUCTS` currently maps;
  `plansWithoutQuota` catches a product mapped to a slug with no quota.

## The rules the integration must obey

1. **A hard quota at the supplier.** Residential bandwidth is billed per gigabyte
   consumed, so the sub-user must be created with `gigabytes` from the plan and
   `days` from the plan. If the supplier will not enforce a cap on its side, the
   plan is not sellable — our books cannot enforce it afterwards.
2. **Issue, then charge.** Buy the allowance, read the credentials back, then debit
   and record — the order the numbers and eSIM paths use. A failure releases the
   allowance (`cancelFleexaProxy`) instead of leaving paid-for bandwidth nobody can
   use.
3. **Usage is read, not assumed.** `checkFleexaProxy` on the order page and in the
   nightly sweep, so "3.2GB of 5GB used" is a fact and an overage surfaces the same
   day rather than at reconciliation.
4. **The plan table is the source of truth for size.** `data/cost-sheet.json` and
   `PRICING.md` describe prices; `src/lib/proxy-plans.ts` describes what gets bought.
   A test fails if the catalogue label and the quota disagree.

## What remains, once the shape is confirmed

1. `POST /api/proxies/purchase` — auth, same-origin, rate limit, `isProxyPlanSellable`,
   supplier buy → order row (credentials in `orders.accounts`, access id in
   `provider_request_id`) → wallet debit in one transaction → refund on write failure.
2. `/dashboard/orders/[id]` — a `ProxyAccess` block: host, port, protocol, username,
   password (copy button, never emailed), quota, used GB, expiry.
3. Nightly usage sweep + a `proxy_usage` note in reconciliation for a cap that is
   reached.
4. Then, and only then, the storefront: `/proxies` and `/pricing` lose the "cannot be
   delivered yet" sentence, and `public-availability-copy.test.tsx` — which asserts no
   proxy plan can be sold — fails first and points at the copy that must change.

Costs already modelled (see `PRICING.md`): ₦2,690/GB Nigeria down to ₦2,000/GB on
the 25GB tier, priced at ₦3,650–₦67,500. Those are assumptions, and the
supplier's own ₦500/GB starting price suggests they are too high — so a written
quote is needed alongside the endpoint answer, not after it.
