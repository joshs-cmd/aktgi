
-- Cache settings per distributor
CREATE TABLE cache_settings (
  distributor TEXT PRIMARY KEY,
  ttl_hours INTEGER NOT NULL DEFAULT 14,
  pre_warm_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT
);

ALTER TABLE cache_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on cache_settings" ON cache_settings FOR SELECT USING (true);
CREATE POLICY "Allow service role insert on cache_settings" ON cache_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on cache_settings" ON cache_settings FOR UPDATE USING (true);

INSERT INTO cache_settings (distributor, ttl_hours, pre_warm_enabled, notes) VALUES
  ('sanmar',        14, true,  'Pre-warmed nightly at 11pm. 14hr TTL covers full workday.'),
  ('ss-activewear', 14, true,  'Pre-warmed nightly at 11pm. 14hr TTL covers full workday.'),
  ('onestop',       14, true,  'Pre-warmed nightly at 11pm. 60 calls/min rate limit enforced.'),
  ('acc',           24, false, 'On-demand cache only. SOAP calls ~35s each — pre-warming not feasible for 2025 SKUs.');

-- Cached provider responses
CREATE TABLE product_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor TEXT NOT NULL,
  style_number TEXT NOT NULL,
  response_data JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(distributor, style_number)
);
CREATE INDEX idx_product_cache_lookup ON product_cache(distributor, style_number);
CREATE INDEX idx_product_cache_expires ON product_cache(expires_at);

ALTER TABLE product_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on product_cache" ON product_cache FOR SELECT USING (true);
CREATE POLICY "Allow service role insert on product_cache" ON product_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on product_cache" ON product_cache FOR UPDATE USING (true);
CREATE POLICY "Allow service role delete on product_cache" ON product_cache FOR DELETE USING (true);

-- Popular SKUs to pre-warm nightly
CREATE TABLE popular_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  style_number TEXT NOT NULL UNIQUE,
  brand TEXT,
  display_name TEXT,
  annual_units INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE popular_skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on popular_skus" ON popular_skus FOR SELECT USING (true);
CREATE POLICY "Allow service role insert on popular_skus" ON popular_skus FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on popular_skus" ON popular_skus FOR UPDATE USING (true);
CREATE POLICY "Allow service role delete on popular_skus" ON popular_skus FOR DELETE USING (true);
