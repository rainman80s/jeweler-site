-- Users / auth
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);

-- Trend intelligence: raw social signals
CREATE TABLE IF NOT EXISTS trend_signals (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT, url TEXT,
  caption TEXT, hashtags TEXT, image_url TEXT,
  likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, views INTEGER DEFAULT 0,
  posted_at INTEGER, score REAL DEFAULT 0, style_tags TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(source, source_id)
);
-- Clustered styles ("chunky gold hoops", "pearl charm necklace") w/ momentum
CREATE TABLE IF NOT EXISTS trends (
  id TEXT PRIMARY KEY, keyword TEXT UNIQUE NOT NULL, momentum REAL DEFAULT 0,
  signal_count INTEGER DEFAULT 0, status TEXT DEFAULT 'new', -- new|sourcing|sourced|ignored
  last_seen INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Supplier products found for a trend
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY, trend_id TEXT, supplier TEXT NOT NULL, supplier_product_id TEXT,
  supplier_url TEXT, title TEXT, cost_cents INTEGER, shipping_cents INTEGER DEFAULT 0,
  ship_days INTEGER, rating REAL, orders INTEGER, images TEXT, raw TEXT,
  score REAL DEFAULT 0, status TEXT DEFAULT 'pending', -- pending|approved|rejected|listed
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(supplier, supplier_product_id)
);

-- Storefront catalog
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT,
  price_cents INTEGER NOT NULL, compare_at_cents INTEGER, cost_cents INTEGER,
  category TEXT, tags TEXT, images TEXT, candidate_id TEXT,
  supplier TEXT, supplier_product_id TEXT, supplier_url TEXT,
  status TEXT DEFAULT 'draft', -- draft|active|archived
  featured INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, stripe_session_id TEXT UNIQUE, email TEXT, shipping TEXT,
  items TEXT NOT NULL, total_cents INTEGER, status TEXT DEFAULT 'pending', -- pending|paid|fulfilling|shipped|failed
  supplier_order_ids TEXT, tracking TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- First-party analytics
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, -- view|product_view|add_to_cart|checkout|purchase
  product_id TEXT, session TEXT, ref TEXT, utm TEXT, value_cents INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_events_product ON events(product_id, type, created_at);

-- Marketing assets
CREATE TABLE IF NOT EXISTS creatives (
  id TEXT PRIMARY KEY, product_id TEXT, kind TEXT, -- ad_image|caption|ugc_script
  platform TEXT, body TEXT, media_key TEXT, status TEXT DEFAULT 'draft',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Autopilot audit log + settings
CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY, job TEXT NOT NULL, status TEXT, summary TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()), finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES
 ('hashtags', '["jewelrytrends","goldjewelry","jewelryinspo","stackingrings","earringstack","charmnecklace","y2kjewelry","pearljewelry"]'),
 ('accounts', '[]'),
 ('suppliers', '["aliexpress","cj","alibaba","temu","shein"]'),
 ('min_margin', '0.6'),
 ('max_ship_days', '15'),
 ('prune_after_days', '14'),
 ('prune_min_views', '150');

-- Image prompts: copy into ChatGPT yourself, upload the result back (no API credits)
CREATE TABLE IF NOT EXISTS image_prompts (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, kind TEXT NOT NULL, -- model|flatlay|ad
  prompt TEXT NOT NULL, ref_image TEXT, meta TEXT, status TEXT DEFAULT 'pending', -- pending|done|skipped
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO settings VALUES ('image_mode', '"manual"');
