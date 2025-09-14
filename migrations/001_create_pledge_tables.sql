-- Pledge Tracker Tables Migration
-- Safe to run on production database - only affects pledge-related tables

-- Create paddle pledges table (one row per tier)
CREATE TABLE IF NOT EXISTS paddle_pledges (
  id SERIAL PRIMARY KEY,
  tier_cents BIGINT NOT NULL,
  count INTEGER DEFAULT 0,
  total_cents BIGINT GENERATED ALWAYS AS (tier_cents * count) STORED,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tier_cents)
);

-- Create text pledges table (one row per text received)
CREATE TABLE IF NOT EXISTS text_pledges (
  id SERIAL PRIMARY KEY,
  amount_cents BIGINT NOT NULL,
  phone_number VARCHAR(20),
  message TEXT,
  webhook_id VARCHAR(100), -- To prevent duplicates from SimpleTexting
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(webhook_id)
);

-- Create view for real-time totals
CREATE OR REPLACE VIEW total_pledges AS
SELECT 
  COALESCE(SUM(p.total_cents), 0) + COALESCE(SUM(t.amount_cents), 0) AS grand_total_cents,
  COALESCE(SUM(p.total_cents), 0) AS paddle_total_cents,
  COALESCE(SUM(t.amount_cents), 0) AS text_total_cents,
  COUNT(p.id) AS paddle_tier_count,
  COUNT(t.id) AS text_pledge_count
FROM paddle_pledges p
CROSS JOIN text_pledges t;

-- Initialize the 10 tiers with zero counts
-- Amounts in cents: $100k, $50k, $25k, $15k, $10k, $5k, $2.5k, $1k, $500, $250
INSERT INTO paddle_pledges (tier_cents, count) VALUES 
(10000000, 0), -- $100,000
(5000000, 0),  -- $50,000
(2500000, 0),  -- $25,000
(1500000, 0),  -- $15,000
(1000000, 0),  -- $10,000
(500000, 0),   -- $5,000
(250000, 0),   -- $2,500
(100000, 0),   -- $1,000
(50000, 0),    -- $500
(25000, 0)     -- $250
ON CONFLICT (tier_cents) DO NOTHING; -- Safe for re-running

-- Create function to reset only pledge data (for testing)
CREATE OR REPLACE FUNCTION reset_pledge_data()
RETURNS void AS $$
BEGIN
  -- Reset paddle pledge counts to zero
  UPDATE paddle_pledges SET count = 0, updated_at = NOW();
  
  -- Delete all text pledges
  DELETE FROM text_pledges;
  
  RAISE NOTICE 'All pledge data has been reset';
END;
$$ LANGUAGE plpgsql;
