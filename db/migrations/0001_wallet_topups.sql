CREATE TABLE IF NOT EXISTS wallet_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference varchar(40) NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount >= 1000 AND amount <= 500000),
  currency varchar(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  method varchar(24) NOT NULL CHECK (method IN ('card', 'bank-transfer')),
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  authorization_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

CREATE INDEX IF NOT EXISTS wallet_topups_user_idx ON wallet_topups (user_id);
