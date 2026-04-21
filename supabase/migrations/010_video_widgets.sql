-- Named video widgets (stories / carousel collections)

CREATE TABLE IF NOT EXISTS video_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'stories',  -- 'stories' | 'carousel' | 'feed'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_widget_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id uuid REFERENCES video_widgets(id) ON DELETE CASCADE NOT NULL,
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE(widget_id, video_id)
);

CREATE INDEX IF NOT EXISTS video_widgets_merchant_idx ON video_widgets(merchant_id);
CREATE INDEX IF NOT EXISTS video_widget_items_widget_idx ON video_widget_items(widget_id, sort_order);

ALTER TABLE video_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_widget_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "merchants_own_video_widgets" ON video_widgets
  USING (merchant_id = auth.uid());

CREATE POLICY "merchants_own_video_widget_items" ON video_widget_items
  USING (widget_id IN (SELECT id FROM video_widgets WHERE merchant_id = auth.uid()));
