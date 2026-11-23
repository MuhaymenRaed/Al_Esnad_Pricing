-- Fixture: the first starter seed (2026-11-20, incl. accessories). Used to test supabase/remove-accessories.sql.
-- Starter data: every brand and device category the shop deals in, plus five
-- example devices with prices. Safe to run repeatedly: brands and categories
-- that already exist (same name, any letter case) are left untouched, and an
-- example device is only added when no device with that name exists.
-- Run in the SQL Editor after the two migrations, or automatically by
-- `supabase db reset` locally.

-- ---------------------------------------------------------------------------
-- 1. Brands
-- ---------------------------------------------------------------------------
insert into public.brands (name, description, accent_color, sort_order) values
  ('Apple',    'iPhone, iPad, Apple Watch and AirPods',                              '#23262C', 10),
  ('Samsung',  'Galaxy S, Galaxy A, Galaxy Tab and wearables',                       '#2563EB', 20),
  ('Xiaomi',   'Xiaomi, Redmi and POCO devices',                                     '#C2185B', 30),
  ('Honor',    'Honor smartphones and tablets',                                      '#0E7490', 40),
  ('Huawei',   'Pura, Mate and nova phones, MatePad tablets, watches and routers',   '#C8102E', 50),
  ('OPPO',     'Find, Reno and A series phones',                                     '#187C54', 60),
  ('vivo',     'X, V and Y series phones',                                           '#4F46E5', 70),
  ('realme',   'Number, GT and C series phones',                                     '#B5831C', 80),
  ('OnePlus',  'OnePlus flagship and Nord series',                                   '#9F1239', 90),
  ('Google',   'Pixel phones, Pixel Watch and Pixel Buds',                           '#1A73E8', 100),
  ('Motorola', 'edge, razr and moto g series',                                       '#1E3A8A', 110),
  ('Nokia',    'Nokia smartphones and feature phones',                               '#124191', 120),
  ('TECNO',    'Phantom, Camon, Pova and Spark series',                              '#7C3AED', 130),
  ('Infinix',  'Zero, Note, GT and Hot series',                                      '#15803D', 140),
  ('itel',     'itel smartphones and feature phones',                                '#DC2626', 150),
  ('ZTE',      'ZTE and nubia phones, mobile and home routers',                      '#0284C7', 160),
  ('Nothing',  'Nothing Phone, CMF phones and audio',                                '#3F3F46', 170),
  ('Lenovo',   'Lenovo tablets and laptops',                                         '#E11D48', 180),
  ('Anker',    'Chargers, power banks, cables and soundcore audio',                  '#0369A1', 190),
  ('JBL',      'Speakers, earbuds and headphones',                                   '#EA580C', 200),
  ('Baseus',   'Chargers, power banks, cables and car accessories',                  '#D97706', 210)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Device categories
-- ---------------------------------------------------------------------------
insert into public.categories (name, description) values
  ('Smartphones',       'Mobile phones'),
  ('Feature phones',    'Basic keypad phones'),
  ('Tablets',           'Tablets and iPads'),
  ('Laptops',           'Laptops and MacBooks'),
  ('Watches',           'Smart watches and wearables'),
  ('Audio',             'Earbuds, headphones and speakers'),
  ('Chargers & cables', 'Wall, car and wireless chargers and cables'),
  ('Power banks',       'Portable batteries'),
  ('Routers',           '4G / 5G mobile and home routers'),
  ('Accessories',       'Cases, covers, screen protectors and other add-ons')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Example devices (active, with prices in the company currency, IQD)
--    Only the four inputs are given; the database trigger works out the
--    discount amount, final cost and selling price.
--
--    Device                       Purchase   Discount   Payback  Profit  → Selling
--    iPhone 17 Pro Max 256GB      1,900,000  1 %        10,000   54,000  → 1,925,000
--    Galaxy A56 5G 256GB            520,000  10,000      —       25,000  →   535,000
--    Redmi Note 14 Pro 256GB        330,000  —           —       20,000  →   350,000
--    Galaxy Watch8 44mm             450,000  2 %         5,000   24,000  →   460,000
--    AirPods Pro 3                  360,000  1 %         —       23,600  →   380,000
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_brand uuid;
  v_id uuid;
begin
  for r in
    select *
    from (values
      ('iPhone 17 Pro Max 256GB', 'Apple', 'Smartphones', 'APL-IP17PM-256',
        '{"Storage": "256 GB", "RAM": "12 GB", "Color": "Cosmic Orange", "Network": "5G", "Warranty": "1 year"}',
        1900000, 'percentage', 1, 10000, 54000),
      ('Galaxy A56 5G 256GB', 'Samsung', 'Smartphones', 'SAM-A56-256',
        '{"Storage": "256 GB", "RAM": "8 GB", "Color": "Awesome Graphite", "Network": "5G", "Warranty": "1 year"}',
        520000, 'fixed', 10000, 0, 25000),
      ('Redmi Note 14 Pro 256GB', 'Xiaomi', 'Smartphones', 'XMI-RN14P-256',
        '{"Storage": "256 GB", "RAM": "8 GB", "Color": "Midnight Black", "Network": "4G", "Warranty": "1 year"}',
        330000, 'percentage', 0, 0, 20000),
      ('Galaxy Watch8 44mm', 'Samsung', 'Watches', 'SAM-GW8-44',
        '{"Size": "44 mm", "Color": "Graphite", "Network": "Bluetooth", "Warranty": "1 year"}',
        450000, 'percentage', 2, 5000, 24000),
      ('AirPods Pro 3', 'Apple', 'Audio', 'APL-APP3',
        '{"Color": "White", "Warranty": "1 year"}',
        360000, 'percentage', 1, 0, 23600)
    ) as s(name, brand, category, sku, metadata, purchase, discount_type, discount_value, payback, profit)
  loop
    continue when exists (select 1 from public.devices d where lower(d.name) = lower(r.name));

    select b.id into v_brand from public.brands b where lower(b.name) = lower(r.brand);
    continue when v_brand is null;

    insert into public.devices (name, brand_id, category_id, sku, metadata, status)
    values (
      r.name,
      v_brand,
      (select c.id from public.categories c where lower(c.name) = lower(r.category)),
      r.sku,
      r.metadata::jsonb,
      'active'
    )
    returning id into v_id;

    insert into public.device_financials (
      device_id, official_purchase_price, discount_type, discount_value, payback_amount, company_profit
    ) values (
      v_id, r.purchase, r.discount_type::public.discount_type, r.discount_value, r.payback, r.profit
    );
  end loop;
end $$;
