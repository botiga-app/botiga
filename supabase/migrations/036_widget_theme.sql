-- ============================================================
-- 036_widget_theme.sql
-- Per-merchant widget theme — JSONB on merchant_settings, read
-- by /api/widget/config and applied as CSS custom properties on
-- the concierge root element at boot.
--
-- Shape:
-- {
--   "primary":       "#dc2626",   -- brand accent, drives user bubbles + send button + active chips
--   "primary_text":  "#ffffff",   -- text on primary surfaces (chips when active, send button)
--   "surface":       "#ffffff",   -- widget container background
--   "surface_text":  "#1f2937",   -- primary text on the widget surface
--   "bot_bubble_bg": "#f3f4f6",   -- bot message bubble background
--   "bot_bubble_text": "#1f2937", -- bot message bubble text
--   "header_bg":     "#dc2626",   -- header strip (often = primary on light themes)
--   "header_text":   "#ffffff",   -- header title + icons
--   "font_family":   "system-ui, -apple-system, sans-serif"
-- }
--
-- All keys optional — anything missing falls back to the widget's
-- built-in dark default. NULL widget_theme = current dark look.
-- ============================================================

ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS widget_theme JSONB;

COMMENT ON COLUMN merchant_settings.widget_theme IS
  'Optional per-merchant widget theme overrides. Keys: primary, primary_text, surface, surface_text, bot_bubble_bg, bot_bubble_text, header_bg, header_text, font_family. Missing keys fall back to the widget default.';
