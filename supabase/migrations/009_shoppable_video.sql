-- Shoppable Video: videos, product tags, analytics events

CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE NOT NULL,
  title text,
  s3_key text NOT NULL,
  s3_url text NOT NULL,
  thumbnail_url text,
  duration_seconds integer,
  width integer,
  height integer,
  source text DEFAULT 'upload',         -- 'upload' | 'instagram' | 'tiktok'
  source_url text,
  status text DEFAULT 'active',         -- 'active' | 'inactive'
  sort_order integer DEFAULT 0,
  views_count integer DEFAULT 0,
  likes_count integer DEFAULT 0,
  shares_count integer DEFAULT 0,
  add_to_cart_count integer DEFAULT 0,
  negotiate_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_product_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE NOT NULL,
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE NOT NULL,
  shopify_product_id text NOT NULL,
  shopify_variant_id text,
  product_name text NOT NULL,
  product_handle text,
  price numeric(10,2),
  compare_at_price numeric(10,2),
  image_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE NOT NULL,
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE NOT NULL,
  session_id text,
  event_type text NOT NULL,  -- 'view' | 'like' | 'share' | 'add_to_cart' | 'buy_now' | 'negotiate' | 'checkout'
  product_id text,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS videos_merchant_id_idx ON videos(merchant_id);
CREATE INDEX IF NOT EXISTS videos_status_idx ON videos(merchant_id, status, sort_order);
CREATE INDEX IF NOT EXISTS video_product_tags_video_id_idx ON video_product_tags(video_id);
CREATE INDEX IF NOT EXISTS video_events_video_id_idx ON video_events(video_id);
CREATE INDEX IF NOT EXISTS video_events_merchant_id_idx ON video_events(merchant_id, created_at);

COMMENT ON TABLE videos IS 'Shoppable video library per merchant';
COMMENT ON TABLE video_product_tags IS 'Products tagged to videos for overlay display';
COMMENT ON TABLE video_events IS 'Per-session analytics events on video interactions';

-- RLS: enable on all tables (service role key bypasses these — policies only matter for direct anon/auth access)
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_product_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_events ENABLE ROW LEVEL SECURITY;

-- Merchants can only access their own videos
CREATE POLICY "merchants_own_videos" ON videos
  USING (merchant_id = auth.uid());

CREATE POLICY "merchants_own_video_product_tags" ON video_product_tags
  USING (merchant_id = auth.uid());

CREATE POLICY "merchants_own_video_events" ON video_events
  USING (merchant_id = auth.uid());
