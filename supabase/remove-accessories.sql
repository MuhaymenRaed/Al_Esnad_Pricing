-- One-off: trims a database seeded with the FIRST starter seed (which also
-- had accessories, wearables, laptops and routers) down to mobile phones and
-- tablets. Run once in the SQL Editor, then run supabase/seed.sql again to add
-- the tablet examples. Safe to run more than once.
--
--   1. Deletes the two seeded non-phone example devices (Galaxy Watch8 44mm,
--      AirPods Pro 3) — matched by name AND seeded SKU, so nothing else is touched.
--   2. Removes the Anker, JBL and Baseus brands and the Laptops, Watches, Audio,
--      Chargers & cables, Power banks, Routers and Accessories categories.
--      Anything still used by a device is DEACTIVATED instead of deleted, so no
--      real data is lost (the result table shows what stayed, as inactive).
--   3. Updates the descriptions of the remaining starter brands to phones and
--      tablets — only where the seeded text was never edited.
-- Deletions are recorded in the audit log like any other change.

delete from public.devices d
where (lower(d.name), d.sku) in (('galaxy watch8 44mm', 'SAM-GW8-44'), ('airpods pro 3', 'APL-APP3'));

-- Categories: delete when unused, otherwise deactivate.
update public.categories c
set is_active = false
where lower(c.name) in ('laptops', 'watches', 'audio', 'chargers & cables', 'power banks', 'routers', 'accessories')
  and c.is_active
  and exists (select 1 from public.devices d where d.category_id = c.id);

delete from public.categories c
where lower(c.name) in ('laptops', 'watches', 'audio', 'chargers & cables', 'power banks', 'routers', 'accessories')
  and not exists (select 1 from public.devices d where d.category_id = c.id);

-- Brands: delete when unused, otherwise deactivate.
update public.brands b
set is_active = false
where lower(b.name) in ('anker', 'jbl', 'baseus')
  and b.is_active
  and exists (select 1 from public.devices d where d.brand_id = b.id);

delete from public.brands b
where lower(b.name) in ('anker', 'jbl', 'baseus')
  and not exists (select 1 from public.devices d where d.brand_id = b.id);

-- Phone & tablet descriptions for the remaining starter brands (untouched ones only).
update public.brands b
set description = v.new_description
from (values
  ('apple',    'iPhone, iPad, Apple Watch and AirPods',                            'iPhone and iPad'),
  ('samsung',  'Galaxy S, Galaxy A, Galaxy Tab and wearables',                     'Galaxy S, Z and A phones, Galaxy Tab tablets'),
  ('xiaomi',   'Xiaomi, Redmi and POCO devices',                                   'Xiaomi, Redmi and POCO phones and tablets'),
  ('huawei',   'Pura, Mate and nova phones, MatePad tablets, watches and routers', 'Pura, Mate and nova phones, MatePad tablets'),
  ('oppo',     'Find, Reno and A series phones',                                   'Find, Reno and A series phones, OPPO Pad'),
  ('vivo',     'X, V and Y series phones',                                         'X, V and Y series phones, vivo Pad'),
  ('realme',   'Number, GT and C series phones',                                   'Number, GT and C series phones, realme Pad'),
  ('oneplus',  'OnePlus flagship and Nord series',                                 'OnePlus and Nord phones, OnePlus Pad'),
  ('google',   'Pixel phones, Pixel Watch and Pixel Buds',                         'Pixel phones and Pixel Tablet'),
  ('nokia',    'Nokia smartphones and feature phones',                             'Nokia smartphones, feature phones and tablets'),
  ('zte',      'ZTE and nubia phones, mobile and home routers',                    'ZTE and nubia phones'),
  ('nothing',  'Nothing Phone, CMF phones and audio',                              'Nothing Phone and CMF Phone'),
  ('lenovo',   'Lenovo tablets and laptops',                                       'Lenovo Tab tablets')
) as v(brand, old_description, new_description)
where lower(b.name) = v.brand
  and b.description = v.old_description;

-- What is left (inactive rows were kept because devices still use them).
select 'brand' as kind, b.name, b.is_active from public.brands b
union all
select 'category', c.name, c.is_active from public.categories c
order by kind, name;
