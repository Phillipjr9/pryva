-- Migration: Add security violations table for anti-reverse-engineering monitoring

CREATE TABLE IF NOT EXISTS security_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email VARCHAR(200),
  type VARCHAR(40) NOT NULL,
  details TEXT NOT NULL,
  ip VARCHAR(45),
  url VARCHAR(500),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS security_violations_user_idx ON security_violations(user_id);
CREATE INDEX IF NOT EXISTS security_violations_type_idx ON security_violations(type);
CREATE INDEX IF NOT EXISTS security_violations_created_idx ON security_violations(created_at);
