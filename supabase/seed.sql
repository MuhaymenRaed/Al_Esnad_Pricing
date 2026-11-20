-- Optional starter structure (brands & categories only — no devices or prices).
-- Safe to run repeatedly. Run in the SQL Editor after the two migrations, or
-- automatically by `supabase db reset` locally.

insert into public.brands (name, description, accent_color, sort_order) values
  ('Apple', 'iPhone, iPad, Apple Watch and AirPods', '#23262C', 10),
  ('Samsung', 'Galaxy S, Galaxy A, Galaxy Tab and wearables', '#2563EB', 20),
  ('Xiaomi', 'Xiaomi, Redmi and POCO devices', '#C2185B', 30),
  ('Honor', 'Honor smartphones and tablets', '#0E7490', 40)
on conflict do nothing;

insert into public.categories (name, description) values
  ('Smartphones', 'Mobile phones'),
  ('Tablets', 'Tablets and iPads'),
  ('Watches', 'Smart watches and wearables'),
  ('Audio', 'Earbuds, headphones and speakers'),
  ('Accessories', 'Cases, chargers, cables and covers')
on conflict do nothing;
