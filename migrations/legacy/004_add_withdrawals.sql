-- Migration: Add withdrawals and bank_accounts tables

CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  bank_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  recipient_code VARCHAR(100),
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  reference VARCHAR(50) NOT NULL UNIQUE,
  transfer_reference VARCHAR(100),
  failure_reason TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals(status);
CREATE INDEX IF NOT EXISTS withdrawals_reference_idx ON withdrawals(reference);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name VARCHAR(100) NOT NULL,
  bank_code VARCHAR(20) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  recipient_code VARCHAR(100),
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_accounts_user_idx ON bank_accounts(user_id);
