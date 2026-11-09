-- Referral rewards are spendable, but not cash. These columns are deliberately
-- separate from the fungible wallet total; no existing wallet is reduced.
--
-- Historical mixed wallets cannot be reconstructed reliably from a total. Mark
-- referrers and all recipients of their historic wallet gift cards for review,
-- including chains of gifts. Outstanding historic cards inherit the same flag.
-- Unknown provenance blocks payouts, not spending or refunds; operators must not
-- simply relabel those balances without an audited source-by-source review.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_credit_balance integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_provenance_known boolean NOT NULL DEFAULT true;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS referral_credit_amount integer;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS referral_credit_amount integer;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS wallet_provenance_known boolean NOT NULL DEFAULT false;

WITH RECURSIVE seeds AS (
  SELECT referrer_id AS id FROM referrals WHERE status = 'credited' OR reward_reference IS NOT NULL
  UNION SELECT user_id AS id FROM wallet_transactions WHERE type = 'credit' AND reference LIKE 'REFL-%'
), affected AS (
  SELECT id FROM seeds
  UNION
  SELECT g.redeemed_by FROM gift_cards g JOIN affected a ON g.purchased_by = a.id WHERE g.redeemed_by IS NOT NULL
)
UPDATE users SET wallet_provenance_known = false WHERE id IN (SELECT id FROM affected);

-- These are all pre-existing cards. Cards minted after this migration start
-- unknown and are assigned their exact source by the debit-ledger trigger.
UPDATE gift_cards g SET referral_credit_amount = 0,
  wallet_provenance_known = COALESCE((SELECT u.wallet_provenance_known FROM users u WHERE u.id = g.purchased_by), false);

CREATE OR REPLACE FUNCTION pryva_track_referral_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  restricted integer;
  known boolean;
  wallet integer;
  carried integer := 0;
  card_known boolean;
  matched integer;
  allocated bigint;
  restored bigint;
BEGIN
  IF NEW.amount <= 0 THEN RAISE EXCEPTION 'Invalid wallet amount'; END IF;
  SELECT referral_credit_balance, wallet_provenance_known, wallet_balance
    INTO restricted, known, wallet FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet owner not found'; END IF;
  NEW.referral_credit_amount := 0;

  IF NEW.type = 'withdrawal' THEN
    -- The debit has already been applied in this transaction. A failed check
    -- rolls back the wallet, withdrawal row and ledger together, before payout.
    IF NOT known OR wallet < restricted THEN
      RAISE EXCEPTION 'Withdrawable wallet funds require review';
    END IF;

  ELSIF NEW.type = 'debit' THEN
    -- Spend promotional credit first, preserving the customer's cash balance.
    carried := LEAST(restricted, NEW.amount);
    NEW.referral_credit_amount := carried;
    UPDATE users SET referral_credit_balance = restricted - carried WHERE id = NEW.user_id;
    IF NEW.reference LIKE 'GIFT-PRYVA-%' THEN
      UPDATE gift_cards SET referral_credit_amount = carried, wallet_provenance_known = known
        WHERE code = substring(NEW.reference from 6) AND purchased_by = NEW.user_id AND initial_amount = NEW.amount;
      GET DIAGNOSTICS matched = ROW_COUNT;
      IF matched <> 1 THEN RAISE EXCEPTION 'Gift card purchase provenance missing'; END IF;
    END IF;

  ELSIF NEW.type = 'credit' THEN
    IF NEW.reference LIKE 'REFL-%' THEN
      IF NOT EXISTS (SELECT 1 FROM referrals r WHERE r.referrer_id = NEW.user_id
          AND r.reward_reference = NEW.reference AND r.status = 'credited' AND r.reward_amount = NEW.amount) THEN
        RAISE EXCEPTION 'Referral credit provenance missing';
      END IF;
      carried := NEW.amount;
    ELSIF NEW.reference LIKE 'GIFT-PRYVA-%' THEN
      SELECT COALESCE(g.referral_credit_amount, 0), g.wallet_provenance_known
        INTO carried, card_known FROM gift_cards g
        WHERE g.code = substring(NEW.reference from 6) AND g.redeemed_by = NEW.user_id
          AND g.status = 'redeemed' AND g.amount = NEW.amount;
      IF NOT FOUND THEN RAISE EXCEPTION 'Gift card redemption provenance missing'; END IF;
      IF NOT card_known THEN UPDATE users SET wallet_provenance_known = false WHERE id = NEW.user_id; END IF;
    END IF;
    NEW.referral_credit_amount := carried;
    UPDATE users SET referral_credit_balance = referral_credit_balance + carried WHERE id = NEW.user_id;

  ELSIF NEW.type = 'refund' THEN
    IF NEW.order_id IS NOT NULL THEN
      SELECT COUNT(*), COALESCE(SUM(referral_credit_amount), 0) INTO matched, allocated
        FROM wallet_transactions WHERE user_id = NEW.user_id AND order_id = NEW.order_id AND type = 'debit';
      SELECT COALESCE(SUM(referral_credit_amount), 0) INTO restored
        FROM wallet_transactions WHERE user_id = NEW.user_id AND order_id = NEW.order_id AND type = 'refund';
      IF matched = 0 THEN
        -- Legacy bulk units were not individually linked to their debit. Credit
        -- the customer, but do not pretend we know what portion was cash.
        UPDATE users SET wallet_provenance_known = false WHERE id = NEW.user_id;
      ELSE
        carried := LEAST(NEW.amount::bigint, GREATEST(allocated - restored, 0))::integer;
      END IF;
    ELSIF NEW.reference NOT LIKE 'RWD-%' THEN
      -- A withdrawal refund uses RWD and only restores cash reserved by a payout.
      -- Unknown unlinked refunds must not silently become withdrawable cash.
      UPDATE users SET wallet_provenance_known = false WHERE id = NEW.user_id;
    END IF;
    NEW.referral_credit_amount := carried;
    UPDATE users SET referral_credit_balance = referral_credit_balance + carried WHERE id = NEW.user_id;
  ELSE
    RAISE EXCEPTION 'Unknown wallet transaction type';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wallet_referral_provenance ON wallet_transactions;
CREATE TRIGGER wallet_referral_provenance BEFORE INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION pryva_track_referral_credit();

-- Wallet arithmetic and its ledger insert are separate statements in the same
-- transaction. Check at commit, not midway, so no restricted amount can vanish.
CREATE OR REPLACE FUNCTION pryva_check_referral_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet integer; restricted integer;
BEGIN
  SELECT wallet_balance, referral_credit_balance INTO wallet, restricted FROM users WHERE id = NEW.id;
  IF FOUND AND (restricted < 0 OR restricted > wallet) THEN
    RAISE EXCEPTION 'Invalid referral credit balance';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS users_referral_balance_check ON users;
CREATE CONSTRAINT TRIGGER users_referral_balance_check AFTER INSERT OR UPDATE ON users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pryva_check_referral_balance();
