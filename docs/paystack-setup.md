# Paystack wallet top-ups

Pryva uses Paystack-hosted checkout for wallet funding. The browser never receives the Paystack secret key or handles card data. A wallet is credited only after Pryva verifies a successful Paystack transaction against the pending top-up's reference, exact kobo amount, and NGN currency. The callback and webhook use the same idempotent settlement routine.

## 1. Apply the database migration

Wallet top-ups require the `wallet_topups` table. Apply the migration to the same PostgreSQL database used by `DATABASE_URL` before deploying the code:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_wallet_topups.sql
```

The migration is additive; it does not alter existing user, order, or wallet transaction rows.

## 2. Configure Paystack keys

In local development, copy `.env.example` to `.env.local`. In production, add the variables through the deployment environment settings (for example, Vercel Project → Settings → Environment Variables):

```env
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_CALLBACK_URL=https://pryva.ng/api/wallet/topup/callback
```

Use a Paystack **test** secret key first. For the live site, use the live secret key only after completing test transactions and reviewing the Paystack account's enabled payment channels. Keep `PAYSTACK_SECRET_KEY` server-side; do not prefix it with `NEXT_PUBLIC_` or put it in client code. The callback variable is optional for local development, but set it to the site's HTTPS URL in production. It must end in `/api/wallet/topup/callback`.

No Paystack public key is needed because customers are redirected to Paystack's hosted checkout.

## 3. Register the webhook

In the Paystack dashboard, configure this webhook URL for the same environment/key:

```text
https://pryva.ng/api/webhooks/paystack
```

Subscribe to `charge.success`. Pryva validates `x-paystack-signature` with HMAC-SHA512 and independently verifies the transaction with Paystack before settlement. Webhook retries and browser callback returns are safe to receive more than once.

## 4. Test the flow

1. Sign in to an account backed by the migrated database.
2. Choose a top-up amount and either bank transfer or card in **Dashboard → Wallet**.
3. Review the amount and continue to Paystack's hosted checkout.
4. Confirm that a successful test payment appears once in wallet history and increments the balance once. Abandoned or failed transactions must not change the balance.

The demo account is read-only regardless of database configuration. Without `DATABASE_URL`, database-backed purchases and funding are unavailable for all accounts. Without `PAYSTACK_SECRET_KEY`, the wallet page shows setup-required guidance and the top-up API refuses to initialize a transaction. Never use a manually supplied client amount or browser redirect status to credit a wallet; settlement is server-verified.
