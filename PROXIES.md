# Proxies — what exists, and the one thing needed before they can be sold

Written 3 November 2026. Fleexa carries residential proxies, which matters because
Fleexa is already the supplier behind numbers, rentals and the temporary inbox — the
same key, the same rate-limit budget, the same envelope. So the proxy family does not
need a new provider relationship; it needs a verified endpoint shape.

## What is already built

| Piece | File | State |
|---|---|---|
| Supplier client (products, buy, usage, cancel) | `src/lib/fleexa.ts` (`Proxy` section) | Written; **endpoint shapes unverified** |
| Plan → gigabytes/days/region | `src/lib/proxy-plans.ts` | Done, and pinned against the catalogue by test |
| Plan → supplier product id | `FLEEXA_PROXY_PRODUCTS` (JSON, deployment data) | You map it; no ids are guessed in code |
| On/off switch | `FLEEXA_PROXY_ENABLED=1` + key + map | Off unless all three are present |
| Read-only supplier probe | `/api/diagnostics/integrations` → `proxies` | Done — reads products, cannot spend |
| Purchase route | — | **Not written, deliberately** (see below) |
| Order page (credentials + used GB) | — | Not written |

## Why there is no checkout yet

The proxy endpoints follow Fleexa's own naming convention (`/sms4/buy`,
`/email/buy`, `/rent/sms4/buy` → `/proxy/products`, `/proxy/buy`,
`/proxy/check/:id`, `/proxy/cancel`). That is evidence of a house style, not a
contract. Debit-then-call against an unverified endpoint is exactly the failure this
codebase is built to refuse: the customer is charged, the call 404s, and somebody
reconciles it by hand.

So the money path waits for one piece of evidence: **a real response**.

## The verification step

With `FLEEXA_API_KEY` set (nothing else):

```sh
curl -s -H "Authorization: Bearer $DIAGNOSTICS_SECRET" \
  "https://<your-domain>/api/diagnostics/integrations" | jq .proxies
```

- `products.count` above zero: the product path and the key are right. The
  `sample` shows the field names so the mapping can be read straight off it.
- `products.ok: false` with `UPSTREAM_ERROR`/404: the path is wrong for this
  deployment. One constant to change (`PROXY_PATH` in `src/lib/fleexa.ts`).
- `mappedPlans` counts what `FLEEXA_PROXY_PRODUCTS` currently maps, and
  `plansWithoutQuota` catches a product mapped to a slug that has no quota.

Then set the mapping, using the ids the probe showed:

```sh
FLEEXA_PROXY_ENABLED=1
FLEEXA_PROXY_PRODUCTS='{"proxy-ng-1":"<id>","proxy-ng-5":"<id>","proxy-us-5":"<id>","proxy-eu-10":"<id>","proxy-ng-25":"<id>"}'
```

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

Costs already modelled (see `PRICING.md`): ₦2,690/GB Nigeria up to ₦2,000/GB on the
25GB tier, priced at ₦3,650–₦67,500. These are assumptions until a real quote, and a
supplier quote is the second thing to fetch after the product list.
