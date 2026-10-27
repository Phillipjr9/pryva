-- Apply before enabling Paystack wallet top-ups or the payment webhook.
-- Each reference is created by the server and can credit a wallet only once.
CREATE TABLE IF NOT EXISTS payment_topups (
  reference VARCHAR(40) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_topups_user_idx ON payment_topups(user_id);
