-- A retry must resolve to the original card before any second wallet debit.
-- Historical cards have no key and remain untouched.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_purchase_request_idx ON gift_cards (purchased_by, request_id);
