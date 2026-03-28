-- AutoHue Admin — D1 Database Schema
-- Run: npx wrangler d1 execute autohue-db --file=schema.sql

-- Customers (license holders)
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  tier TEXT NOT NULL DEFAULT 'trial',
  license_key TEXT UNIQUE,
  machine_id TEXT,
  machine_slots INTEGER DEFAULT 2,
  machines_used INTEGER DEFAULT 0,
  activated_at TEXT,
  expires_at TEXT,
  last_validated TEXT,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  paypal_subscription_id TEXT,
  subscription_status TEXT DEFAULT 'active',
  subscription_plan_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- PayPal payments
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  paypal_order_id TEXT UNIQUE,
  paypal_payer_id TEXT,
  paypal_payer_email TEXT,
  amount_usd REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  tier TEXT NOT NULL,
  status TEXT DEFAULT 'completed',
  created_at TEXT DEFAULT (datetime('now'))
);

-- License validation log (desktop app check-ins)
CREATE TABLE IF NOT EXISTS validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  machine_id TEXT,
  app_version TEXT,
  ip_address TEXT,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Admin audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pending subscription activations (webhook pattern)
CREATE TABLE IF NOT EXISTS pending_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan TEXT NOT NULL,
  email TEXT,
  paypal_subscription_id TEXT,
  paypal_customer_id TEXT,
  activated_at TEXT DEFAULT (datetime('now')),
  consumed INTEGER DEFAULT 0
);

-- Pending subscription cancellations (webhook pattern)
CREATE TABLE IF NOT EXISTS pending_cancellations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  paypal_subscription_id TEXT,
  cancelled_at TEXT DEFAULT (datetime('now')),
  consumed INTEGER DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_license_key ON customers(license_key);
CREATE INDEX IF NOT EXISTS idx_customers_tier ON customers(tier);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_validations_customer_id ON validations(customer_id);
CREATE INDEX IF NOT EXISTS idx_validations_created_at ON validations(created_at);
