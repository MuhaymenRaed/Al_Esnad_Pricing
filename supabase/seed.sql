-- Starter data: the mobile phone and tablet brands the shop sells, their
-- categories, and five example devices with prices. Safe to run repeatedly:
-- brands and categories that already exist (same name, any letter case) are
-- left untouched, and an example device is only added when no device with that
-- name exists. Run in the SQL Editor after the migrations, or automatically by
-- `supabase db reset` locally.
--
-- Databases seeded with the first version (which also had accessories,
-- wearables, laptops and routers): run supabase/remove-accessories.sql once,
-- then this file again.

-- ---------------------------------------------------------------------------
-- 1. Brands — mobile phone and tablet makers
-- ---------------------------------------------------------------------------
insert into public.brands (name, description, accent_color, sort_order) values
  ('Apple',    'iPhone and iPad',                                   '#23262C', 10),
  ('Samsung',  'Galaxy S, Z and A phones, Galaxy Tab tablets',      '#2563EB', 20),
  ('Xiaomi',   'Xiaomi, Redmi and POCO phones and tablets',         '#C2185B', 30),
  ('Honor',    'Honor smartphones and tablets',                     '#0E7490', 40),
  ('Huawei',   'Pura, Mate and nova phones, MatePad tablets',       '#C8102E', 50),
  ('OPPO',     'Find, Reno and A series phones, OPPO Pad',          '#187C54', 60),
  ('vivo',     'X, V and Y series phones, vivo Pad',                '#4F46E5', 70),
  ('realme',   'Number, GT and C series phones, realme Pad',        '#B5831C', 80),
  ('OnePlus',  'OnePlus and Nord phones, OnePlus Pad',              '#9F1239', 90),
  ('Google',   'Pixel phones and Pixel Tablet',                     '#1A73E8', 100),
  ('Motorola', 'edge, razr and moto g series',                      '#1E3A8A', 110),
  ('Nokia',    'Nokia smartphones, feature phones and tablets',     '#124191', 120),
  ('TECNO',    'Phantom, Camon, Pova and Spark series',             '#7C3AED', 130),
  ('Infinix',  'Zero, Note, GT and Hot series',                     '#15803D', 140),
  ('itel',     'itel smartphones and feature phones',               '#DC2626', 150),
  ('ZTE',      'ZTE and nubia phones',                              '#0284C7', 160),
  ('Nothing',  'Nothing Phone and CMF Phone',                       '#3F3F46', 170),
  ('Lenovo',   'Lenovo Tab tablets',                                '#E11D48', 180)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Categories — phones and tablets only
-- ---------------------------------------------------------------------------
insert into public.categories (name, description) values
  ('Smartphones',    'Mobile phones'),
  ('Feature phones', 'Basic keypad phones'),
  ('Tablets',        'Tablets and iPads')
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
--    iPad Air 11 (M3) 128GB         850,000  1 %         5,000   38,500  →   875,000
--    Galaxy Tab S10 FE 128GB        620,000  15,000      —       30,000  →   635,000
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
      ('iPad Air 11 (M3) 128GB', 'Apple', 'Tablets', 'APL-IPADAIR11-M3-128',
        '{"Storage": "128 GB", "Color": "Space Gray", "Network": "Wi-Fi", "Warranty": "1 year"}',
        850000, 'percentage', 1, 5000, 38500),
      ('Galaxy Tab S10 FE 128GB', 'Samsung', 'Tablets', 'SAM-TABS10FE-128',
        '{"Storage": "128 GB", "RAM": "8 GB", "Color": "Gray", "Network": "Wi-Fi", "Warranty": "1 year"}',
        620000, 'fixed', 15000, 0, 30000)
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
