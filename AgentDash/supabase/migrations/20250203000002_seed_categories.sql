-- =============================================================================
-- Seed Exclusivity Categories
-- =============================================================================

INSERT INTO public.exclusivity_categories (name) VALUES
  ('Energy Drink'),
  ('Apparel'),
  ('Footwear'),
  ('Sports Equipment'),
  ('Nutrition'),
  ('Electronics'),
  ('Automotive'),
  ('Financial Services'),
  ('Travel'),
  ('Food & Beverage'),
  ('Gaming'),
  ('Social Media'),
  ('Beauty & Personal Care'),
  ('Fitness'),
  ('Other')
ON CONFLICT (name) DO NOTHING;
