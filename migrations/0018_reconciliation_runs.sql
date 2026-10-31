-- The daily close.
--
-- One row per business day, written by the nightly job and readable by an
-- operator. Why a table rather than a log line: "we reconcile every day" is a
-- claim that has to be checkable after the fact. A row per day is the evidence —
-- including for the days when the job failed, which is why the run is inserted
-- before the work and updated after it.
--
-- `day` is UNIQUE: re-running a day (a backfill, a retried cron) corrects that
-- day's row instead of creating a second, contradictory one.
--
-- `totals` is jsonb because these are reports, not ledgers: nothing joins to a
-- number in here. The money itself stays in `wallet_transactions`,
-- `payment_topups`, `orders` and `withdrawals`, where it is already constrained.
--
-- `status` is 'running' | 'clean' | 'attention'. 'attention' means the wallet
-- ledger did not add up, which is the one finding that always needs a person.
--
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS "reconciliation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "day" date NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'running',
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone,
  "accounts_checked" integer NOT NULL DEFAULT 0,
  "discrepancies" integer NOT NULL DEFAULT 0,
  "totals" jsonb,
  "notes" text,
  CONSTRAINT "reconciliation_runs_day_unique" UNIQUE ("day")
);

CREATE INDEX IF NOT EXISTS "reconciliation_runs_started_idx" ON "reconciliation_runs" ("started_at");

COMMENT ON COLUMN "reconciliation_runs"."status" IS
  'running | clean | attention. attention = the wallet ledger did not add up.';
COMMENT ON COLUMN "reconciliation_runs"."totals" IS
  'Report only: the day''s counts and sums per money source. Nothing joins to it.';
