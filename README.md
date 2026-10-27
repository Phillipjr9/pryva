# Pryva

Next.js application for a wallet and digital services. The repository currently supports an **in-memory preview**, not a verified production deployment. Live service purchasing is deliberately disabled until the provider integration, catalog mappings and payment/reconciliation workflows have been verified.

## Local development

```sh
npm ci
npm run dev
```

Open `http://localhost:3000` and use the demo login. Without `DATABASE_URL`, users, sessions, balances and orders are held in memory, shared only within one server process and lost on restart. Preview funds and orders are simulated; they are not real money or services. Top-ups and the Paystack webhook are disabled in this mode. Do not use the preview database for a multi-instance or production deployment.

Run the checks with:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

The security tests use mocks, not a real PostgreSQL instance or live providers.

## Deployment configuration and prerequisites

The following are server-side environment variables unless otherwise noted. Store secrets in the deployment environment, not in the repository.

- `DATABASE_URL`: PostgreSQL connection string. Ensure the existing application schema is present before applying new migrations.
- `ADMIN_EMAILS`: comma-separated, explicitly authorized email addresses. There is **no default administrator**; the demo identity can never be an admin. The allowlist is a privilege boundary, not proof of identity. See provisioning below before setting it on an existing deployment.
- `PAYSTACK_SECRET_KEY`: Paystack secret used to initialize checkout and verify webhook signatures. Use separate test and live credentials.
- `NEXT_PUBLIC_APP_URL`: the external HTTPS app URL used for the Paystack return URL. `NEXT_PUBLIC_SITE_URL` can also pin the external origin for OAuth behind a proxy.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: optional Google sign-in credentials. Configure the provider's callback URL for `/api/auth/google/callback`. Google accounts must have a verified email.
- `CRON_SECRET`: a strong secret required as `Authorization: Bearer <secret>` for `POST /api/cron/scheduled-orders`. Live scheduled fulfillment remains disabled.

The reverse proxy must overwrite untrusted forwarded host/protocol headers and expose the site over HTTPS. Admin and financial browser mutations check the request origin; requests without an `Origin` header may be accepted for non-browser clients.

### Administrator provisioning

Admin access is granted by the authenticated user's email matching `ADMIN_EMAILS`. Public password signup now refuses configured admin and demo addresses, but older accounts may have been created without email verification. **Before enabling an address on an existing installation**, use a maintenance window to verify the account's ownership out of band, review/reset any untrusted password credential, and revoke existing sessions for that account. Otherwise an attacker who previously registered that email or retained a session could become an administrator as soon as it is allowlisted. Configure the allowlist before reopening public signup. A verified Google sign-in may create a new account for a configured address; no default password or demo admin is provided. Review access periodically.

This is not a complete authentication or security audit. Password accounts do not have a verified-email onboarding flow, and production deployment requires additional security review and operational controls.

### Paystack wallet top-ups

Before routing top-ups or webhooks to this version, back up the database and apply the migration to an existing compatible schema, for example:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/005_create_payment_topups.sql
```

Configure Paystack's webhook URL as `https://<your-domain>/api/webhooks/payment` and ensure it sends `charge.success` events with its `x-paystack-signature` header. The server verifies the raw-body HMAC-SHA512 signature, currency, amount, metadata and a matching server-created pending top-up; the status change, wallet credit and ledger entry commit together. A repeated matching event cannot credit twice.

**Reconcile existing payments before cutover.** Payments initiated by older versions have no pending record in `payment_topups`, so their webhook events will not be credited by this version. Compare Paystack transactions against the old ledger and resolve each discrepancy with a controlled, auditable, once-only process. Never blindly replay or re-credit historical events. Test with Paystack test keys and a real staging database before using live funds.

### Withdrawals and provider limitations

A withdrawal reserves wallet funds and creates its ledger record in one transaction. Admin approval claims a pending request before contacting Paystack. An ambiguous transfer failure remains `processing` rather than automatically refunding; even a successful initiation is not proof of settlement. Operators must inspect the Paystack dashboard and match reference, amount, recipient and final status before marking a transfer complete or resolving/refunding it manually. Do not retry or refund an uncertain transfer until its outcome is confirmed. Transfer webhooks are not currently used to settle withdrawals automatically.

Live virtual-number, email, eSIM, proxy, digital/data, airtime, bulk and scheduled purchases are disabled. The historical Fleexa adapter remains in the codebase for investigation, but its endpoints and catalog mappings have not been verified, and some advertised plans previously mapped to different countries or quantities. Do not enable live purchasing simply by providing an API key. Legacy live-order refunds require manual provider reconciliation; preview orders remain simulated. Validate provider contracts, pricing, delivery, idempotency and failure recovery with a staging environment before implementing live fulfillment.
