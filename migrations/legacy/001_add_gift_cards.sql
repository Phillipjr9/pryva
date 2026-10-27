-- Gift cards table
CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  initial_amount INTEGER NOT NULL,
  purchased_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_email VARCHAR(200),
  message TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gift_cards_code_idx ON gift_cards(code);
CREATE INDEX IF NOT EXISTS gift_cards_status_idx ON gift_cards(status);
CREATE INDEX IF NOT EXISTS gift_cards_purchased_by_idx ON gift_cards(purchased_by);
CREATE INDEX IF NOT EXISTS gift_cards_redeemed_by_idx ON gift_cards(redeemed_by);
