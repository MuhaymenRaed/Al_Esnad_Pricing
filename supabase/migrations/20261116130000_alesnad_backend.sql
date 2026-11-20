-- ============================================================================
-- AL-ESNAD DEVICE PRICING & MANAGEMENT SYSTEM
-- Supabase PostgreSQL backend migration (BASELINE — as deployed to the project)
--
-- This file is the company's original backend script, kept verbatim except
-- that the outer BEGIN/COMMIT were removed (migration runners wrap each file
-- in a transaction). Application-specific additions live in the following
-- migration (20261117090000_app_extensions.sql).
--
-- Roles:
--   administrator   - full access; cannot be locked out by permission settings
--   pricing_manager - manages device data and all pricing inputs
--   viewer          - sees active devices and final selling prices only
--   data_entry      - submits device details and purchase price for review
--
-- Important:
--   1. Disable public sign-ups in Supabase Auth.
--   2. Invite employees through Supabase Auth Admin API from a trusted server.
--   3. Promote the first administrator using the bootstrap SQL at the end.
--   4. Configure Brevo SMTP in Supabase Auth settings; SMTP credentials do not
--      belong in SQL or in frontend code.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Enumerated types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum (
    'administrator',
    'pricing_manager',
    'viewer',
    'data_entry'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.discount_type as enum ('percentage', 'fixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.device_status as enum (
    'draft',
    'pending_review',
    'active',
    'rejected',
    'archived'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Core tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  role public.app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_not_blank check (length(btrim(email)) > 0)
);
create unique index if not exists profiles_email_lower_uidx
  on public.profiles (lower(email));

create table if not exists public.brands (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  description text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_name_not_blank check (length(btrim(name)) > 0)
);
create unique index if not exists brands_name_lower_uidx
  on public.brands (lower(name));

create table if not exists public.categories (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0)
);
create unique index if not exists categories_name_lower_uidx
  on public.categories (lower(name));

create table if not exists public.devices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  brand_id uuid not null references public.brands(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  sku text,
  model_number text,
  metadata jsonb not null default '{}'::jsonb,
  status public.device_status not null default 'pending_review',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_name_not_blank check (length(btrim(name)) > 0),
  constraint devices_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.device_financials (
  device_id uuid primary key references public.devices(id) on delete cascade,
  official_purchase_price numeric(18,2) not null,
  discount_type public.discount_type not null default 'percentage',
  discount_value numeric(18,4) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  payback_amount numeric(18,2) not null default 0,
  final_cost_before_profit numeric(18,2) not null default 0,
  company_profit numeric(18,2) not null default 0,
  final_selling_price numeric(18,2) not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_purchase_nonnegative check (official_purchase_price >= 0),
  constraint financial_discount_value_nonnegative check (discount_value >= 0),
  constraint financial_payback_nonnegative check (payback_amount >= 0),
  constraint financial_profit_nonnegative check (company_profit >= 0),
  constraint financial_discount_amount_nonnegative check (discount_amount >= 0),
  constraint financial_final_cost_nonnegative check (final_cost_before_profit >= 0),
  constraint financial_selling_price_nonnegative check (final_selling_price >= 0)
);

-- This table contains ONLY the selling price needed by Viewer users.
-- Purchase price, discount, payback, cost, and profit are never copied here.
create table if not exists public.device_public_pricing (
  device_id uuid primary key references public.devices(id) on delete cascade,
  final_selling_price numeric(18,2) not null,
  currency_code char(3) not null default 'IQD',
  updated_at timestamptz not null default now(),
  constraint public_price_nonnegative check (final_selling_price >= 0)
);

create table if not exists public.company_settings (
  id boolean primary key default true check (id = true),
  company_name text not null default 'شركة الاسناد لتجارة الهاتف النقال',
  company_logo_url text,
  currency_code char(3) not null default 'IQD',
  currency_decimal_places smallint not null default 0,
  timezone_name text not null default 'Asia/Baghdad',
  updated_at timestamptz not null default now(),
  constraint settings_currency_code_length check (length(currency_code) = 3),
  constraint settings_currency_scale check (currency_decimal_places between 0 and 4)
);
insert into public.company_settings (id)
values (true)
on conflict (id) do nothing;

-- Permission catalog is controlled by the database developer.
-- role_permissions is the Administrator-editable role/permission matrix.
create table if not exists public.permission_catalog (
  permission_key text primary key,
  description text not null,
  permission_group text not null
);

create table if not exists public.role_permissions (
  role public.app_role not null,
  permission_key text not null references public.permission_catalog(permission_key) on delete cascade,
  allowed boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (role, permission_key)
);

create table if not exists public.audit_logs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Permission catalogue and initial role matrix
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (permission_key, description, permission_group)
values
  ('devices.read_all', 'Read all device records, including pending and archived records.', 'devices'),
  ('devices.read_public', 'Read active device catalogue records.', 'devices'),
  ('devices.read_own_submissions', 'Read own pending or rejected device submissions.', 'devices'),
  ('devices.create', 'Create fully managed device records.', 'devices'),
  ('devices.update', 'Edit device names, brand, category, and metadata.', 'devices'),
  ('devices.archive', 'Archive device records.', 'devices'),
  ('devices.submit', 'Submit a device and its official purchase price for review.', 'devices'),
  ('financials.read', 'Read private financial inputs and calculated financial values.', 'financials'),
  ('financials.update', 'Create or update private financial inputs.', 'financials'),
  ('pricing.read_public', 'Read final selling prices published to the catalogue.', 'pricing'),
  ('reports.export', 'Export records the current role is authorized to read.', 'reports'),
  ('brands.read', 'Read active brands.', 'catalogue'),
  ('brands.manage', 'Create, edit, activate, and deactivate brands.', 'catalogue'),
  ('categories.read', 'Read active categories.', 'catalogue'),
  ('categories.manage', 'Create, edit, activate, and deactivate categories.', 'catalogue'),
  ('submissions.review', 'Approve or reject pending device submissions.', 'devices'),
  ('users.manage', 'Read user profiles and administer user activation.', 'users'),
  ('roles.manage', 'Read and modify role permissions.', 'users'),
  ('audit.read', 'Read the administrative audit log.', 'administration'),
  ('settings.manage', 'Modify company settings.', 'administration')
on conflict (permission_key) do update
set description = excluded.description,
    permission_group = excluded.permission_group;

-- Initial permissions. Administrators always have every permission in the
-- has_permission() function, regardless of rows in role_permissions.
insert into public.role_permissions (role, permission_key, allowed)
values
  -- Pricing Manager
  ('pricing_manager', 'devices.read_all', true),
  ('pricing_manager', 'devices.create', true),
  ('pricing_manager', 'devices.update', true),
  ('pricing_manager', 'devices.archive', true),
  ('pricing_manager', 'financials.read', true),
  ('pricing_manager', 'financials.update', true),
  ('pricing_manager', 'pricing.read_public', true),
  ('pricing_manager', 'reports.export', true),
  ('pricing_manager', 'brands.read', true),
  ('pricing_manager', 'categories.read', true),
  ('pricing_manager', 'submissions.review', true),
  -- Viewer
  ('viewer', 'devices.read_public', true),
  ('viewer', 'pricing.read_public', true),
  ('viewer', 'reports.export', true),
  ('viewer', 'brands.read', true),
  ('viewer', 'categories.read', true),
  -- Data Entry Operator
  ('data_entry', 'devices.read_own_submissions', true),
  ('data_entry', 'devices.submit', true),
  ('data_entry', 'brands.read', true),
  ('data_entry', 'categories.read', true)
on conflict (role, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Security helper functions
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
    and p.is_active = true
  limit 1;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.is_active = true
  );
$$;

create or replace function public.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      p.is_active
      and (
        p.role = 'administrator'::public.app_role
        or exists (
          select 1
          from public.role_permissions as rp
          where rp.role = p.role
            and rp.permission_key = p_permission_key
            and rp.allowed = true
        )
      )
    from public.profiles as p
    where p.id = (select auth.uid())
    limit 1
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 5. Shared timestamp trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Auth user -> profile trigger
--    Never trust user-supplied metadata for role assignment.
-- ---------------------------------------------------------------------------
create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id, email, full_name, email_confirmed_at, last_sign_in_at, role, is_active
  )
  values (
    new.id,
    lower(new.email),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    new.email_confirmed_at,
    new.last_sign_in_at,
    'viewer'::public.app_role,
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        email_confirmed_at = excluded.email_confirmed_at,
        last_sign_in_at = excluded.last_sign_in_at,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert or update of email, email_confirmed_at, last_sign_in_at on auth.users
for each row execute function public.handle_auth_user_profile();

-- Backfill any pre-existing Auth accounts with the safe default Viewer role.
insert into public.profiles (id, email, full_name, email_confirmed_at, last_sign_in_at)
select
  u.id, lower(u.email), nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  u.email_confirmed_at, u.last_sign_in_at
from auth.users as u
where u.email is not null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Pricing calculation trigger
-- ---------------------------------------------------------------------------
create or replace function public.calculate_device_financials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scale integer;
  v_discount numeric(18,2);
  v_final_cost numeric(18,2);
  v_selling_price numeric(18,2);
begin
  select s.currency_decimal_places
    into v_scale
  from public.company_settings as s
  where s.id = true;

  v_scale := coalesce(v_scale, 0);

  if new.official_purchase_price < 0 then
    raise exception 'Official purchase price cannot be negative.';
  end if;
  if new.discount_value < 0 then
    raise exception 'Discount value cannot be negative.';
  end if;
  if new.payback_amount < 0 then
    raise exception 'Payback amount cannot be negative.';
  end if;
  if new.company_profit < 0 then
    raise exception 'Company profit cannot be negative.';
  end if;

  if new.discount_type = 'percentage'::public.discount_type then
    if new.discount_value > 100 then
      raise exception 'Percentage discount cannot exceed 100%%.';
    end if;
    v_discount := round(
      new.official_purchase_price * new.discount_value / 100,
      v_scale
    );
  else
    v_discount := round(new.discount_value, v_scale);
    if v_discount > new.official_purchase_price then
      raise exception 'Fixed discount cannot exceed the official purchase price.';
    end if;
  end if;

  v_final_cost := round(
    new.official_purchase_price - v_discount - new.payback_amount,
    v_scale
  );

  if v_final_cost < 0 then
    raise exception 'Discount and payback cannot exceed the official purchase price.';
  end if;

  v_selling_price := round(v_final_cost + new.company_profit, v_scale);

  new.discount_amount := v_discount;
  new.final_cost_before_profit := v_final_cost;
  new.final_selling_price := v_selling_price;
  new.updated_at := now();
  if (select auth.uid()) is not null then
    new.updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists calculate_financial_values on public.device_financials;
create trigger calculate_financial_values
before insert or update
on public.device_financials
for each row execute function public.calculate_device_financials();

-- ---------------------------------------------------------------------------
-- 8. Public selling-price projection synchronization
-- ---------------------------------------------------------------------------
create or replace function public.sync_device_public_pricing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_status public.device_status;
  v_selling_price numeric(18,2);
  v_currency_code char(3);
begin
  if tg_table_name = 'devices' then
    if tg_op = 'DELETE' then
      v_device_id := old.id;
    else
      v_device_id := new.id;
    end if;
  else
    if tg_op = 'DELETE' then
      v_device_id := old.device_id;
    else
      v_device_id := new.device_id;
    end if;
  end if;

  if tg_op = 'DELETE' and tg_table_name = 'devices' then
    delete from public.device_public_pricing
    where device_id = v_device_id;
    return old;
  end if;

  select d.status
    into v_status
  from public.devices as d
  where d.id = v_device_id;

  if not found or v_status <> 'active'::public.device_status then
    delete from public.device_public_pricing
    where device_id = v_device_id;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select f.final_selling_price
    into v_selling_price
  from public.device_financials as f
  where f.device_id = v_device_id;

  if not found then
    delete from public.device_public_pricing
    where device_id = v_device_id;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select s.currency_code
    into v_currency_code
  from public.company_settings as s
  where s.id = true;

  insert into public.device_public_pricing (
    device_id, final_selling_price, currency_code, updated_at
  ) values (
    v_device_id, v_selling_price, coalesce(v_currency_code, 'IQD'), now()
  )
  on conflict (device_id) do update
    set final_selling_price = excluded.final_selling_price,
        currency_code = excluded.currency_code,
        updated_at = now();

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists sync_public_price_after_financial_change on public.device_financials;
create trigger sync_public_price_after_financial_change
after insert or update or delete on public.device_financials
for each row execute function public.sync_device_public_pricing();

drop trigger if exists sync_public_price_after_device_status_change on public.devices;
create trigger sync_public_price_after_device_status_change
after insert or update of status or delete on public.devices
for each row execute function public.sync_device_public_pricing();

create or replace function public.sync_public_price_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.device_public_pricing
  set currency_code = new.currency_code,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_public_price_currency_after_settings on public.company_settings;
create trigger sync_public_price_currency_after_settings
after update of currency_code on public.company_settings
for each row execute function public.sync_public_price_currency();

-- Recalculate every stored price if the currency's rounding precision changes.
create or replace function public.recalculate_financials_on_currency_scale_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency_decimal_places is distinct from old.currency_decimal_places then
    update public.device_financials as f
    set discount_value = f.discount_value;
  end if;
  return new;
end;
$$;

drop trigger if exists recalculate_financials_after_currency_scale_change on public.company_settings;
create trigger recalculate_financials_after_currency_scale_change
after update of currency_decimal_places on public.company_settings
for each row execute function public.recalculate_financials_on_currency_scale_change();

-- ---------------------------------------------------------------------------
-- 9. Audit logging trigger
--    Audit logs are readable only by users with audit.read (Administrator by
--    default). Financial before/after data is intentionally retained here.
-- ---------------------------------------------------------------------------
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record_id uuid;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_old := null;
    v_new := to_jsonb(new);
    if tg_table_name = 'company_settings' then
      v_record_id := null;
    else
      v_record_id := coalesce(v_new ->> 'id', v_new ->> 'device_id')::uuid;
    end if;
    v_action := 'INSERT';
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if tg_table_name = 'company_settings' then
      v_record_id := null;
    else
      v_record_id := coalesce(v_new ->> 'id', v_new ->> 'device_id')::uuid;
    end if;
    v_action := 'UPDATE';
  else
    v_old := to_jsonb(old);
    v_new := null;
    if tg_table_name = 'company_settings' then
      v_record_id := null;
    else
      v_record_id := coalesce(v_old ->> 'id', v_old ->> 'device_id')::uuid;
    end if;
    v_action := 'DELETE';
  end if;

  insert into public.audit_logs (
    actor_id, action, table_name, record_id, old_data, new_data
  ) values (
    (select auth.uid()), v_action, tg_table_name, v_record_id, v_old, v_new
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Timestamp and audit triggers
-- ---------------------------------------------------------------------------
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at before update on public.brands
for each row execute function public.set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at before update on public.devices
for each row execute function public.set_updated_at();

drop trigger if exists device_financials_set_updated_at on public.device_financials;
create trigger device_financials_set_updated_at before update on public.device_financials
for each row execute function public.set_updated_at();

drop trigger if exists company_settings_set_updated_at on public.company_settings;
create trigger company_settings_set_updated_at before update on public.company_settings
for each row execute function public.set_updated_at();

drop trigger if exists role_permissions_set_updated_at on public.role_permissions;
create trigger role_permissions_set_updated_at before update on public.role_permissions
for each row execute function public.set_updated_at();

drop trigger if exists brands_audit on public.brands;
create trigger brands_audit after insert or update or delete on public.brands
for each row execute function public.write_audit_log();

drop trigger if exists categories_audit on public.categories;
create trigger categories_audit after insert or update or delete on public.categories
for each row execute function public.write_audit_log();

drop trigger if exists devices_audit on public.devices;
create trigger devices_audit after insert or update or delete on public.devices
for each row execute function public.write_audit_log();

drop trigger if exists device_financials_audit on public.device_financials;
create trigger device_financials_audit after insert or update or delete on public.device_financials
for each row execute function public.write_audit_log();

drop trigger if exists role_permissions_audit on public.role_permissions;
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
for each row execute function public.write_audit_log();

drop trigger if exists company_settings_audit on public.company_settings;
create trigger company_settings_audit after update on public.company_settings
for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- 11. Indexes for filters, joins, and search
-- ---------------------------------------------------------------------------
create index if not exists devices_brand_id_idx on public.devices (brand_id);
create index if not exists devices_category_id_idx on public.devices (category_id);
create index if not exists devices_status_idx on public.devices (status);
create index if not exists devices_created_at_idx on public.devices (created_at desc);
create index if not exists devices_updated_at_idx on public.devices (updated_at desc);
create index if not exists devices_created_by_idx on public.devices (created_by);
create index if not exists devices_name_trgm_idx
  on public.devices using gin (name extensions.gin_trgm_ops);
create index if not exists devices_sku_trgm_idx
  on public.devices using gin (sku extensions.gin_trgm_ops);
create index if not exists devices_model_number_trgm_idx
  on public.devices using gin (model_number extensions.gin_trgm_ops);
create index if not exists devices_metadata_gin_idx
  on public.devices using gin (metadata jsonb_path_ops);
create index if not exists devices_metadata_text_trgm_idx
  on public.devices using gin ((metadata::text) extensions.gin_trgm_ops);
create index if not exists brands_name_trgm_idx
  on public.brands using gin (name extensions.gin_trgm_ops);
create index if not exists categories_name_trgm_idx
  on public.categories using gin (name extensions.gin_trgm_ops);
create index if not exists brands_active_name_idx
  on public.brands (is_active, lower(name));
create index if not exists categories_active_name_idx
  on public.categories (is_active, lower(name));
create index if not exists financials_purchase_price_idx
  on public.device_financials (official_purchase_price);
create index if not exists financials_final_cost_idx
  on public.device_financials (final_cost_before_profit);
create index if not exists financials_profit_idx
  on public.device_financials (company_profit);
create index if not exists financials_selling_price_idx
  on public.device_financials (final_selling_price);
create index if not exists public_pricing_selling_price_idx
  on public.device_public_pricing (final_selling_price);
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_table_record_idx
  on public.audit_logs (table_name, record_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 12. RLS enablement
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.devices enable row level security;
alter table public.device_financials enable row level security;
alter table public.device_public_pricing enable row level security;
alter table public.company_settings enable row level security;
alter table public.permission_catalog enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- 13. RLS policies
-- ---------------------------------------------------------------------------

-- Profiles: users can read their own profile; administrators can manage-view all.
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.has_permission('users.manage')));

-- Brands: active users with brands.read can read; brands.manage controls writes.
drop policy if exists brands_read_permission on public.brands;
create policy brands_read_permission
on public.brands for select to authenticated
using ((select public.has_permission('brands.read')));
drop policy if exists brands_insert_permission on public.brands;
create policy brands_insert_permission
on public.brands for insert to authenticated
with check ((select public.has_permission('brands.manage')));
drop policy if exists brands_update_permission on public.brands;
create policy brands_update_permission
on public.brands for update to authenticated
using ((select public.has_permission('brands.manage')))
with check ((select public.has_permission('brands.manage')));
drop policy if exists brands_delete_permission on public.brands;
create policy brands_delete_permission
on public.brands for delete to authenticated
using ((select public.has_permission('brands.manage')));

-- Categories: same management model as brands.
drop policy if exists categories_read_permission on public.categories;
create policy categories_read_permission
on public.categories for select to authenticated
using ((select public.has_permission('categories.read')));
drop policy if exists categories_insert_permission on public.categories;
create policy categories_insert_permission
on public.categories for insert to authenticated
with check ((select public.has_permission('categories.manage')));
drop policy if exists categories_update_permission on public.categories;
create policy categories_update_permission
on public.categories for update to authenticated
using ((select public.has_permission('categories.manage')))
with check ((select public.has_permission('categories.manage')));
drop policy if exists categories_delete_permission on public.categories;
create policy categories_delete_permission
on public.categories for delete to authenticated
using ((select public.has_permission('categories.manage')));

-- Device reads vary by role. There are intentionally no direct write policies.
drop policy if exists devices_select_by_permission on public.devices;
create policy devices_select_by_permission
on public.devices for select to authenticated
using (
  (select public.has_permission('devices.read_all'))
  or (
    status = 'active'::public.device_status
    and (select public.has_permission('devices.read_public'))
  )
  or (
    created_by = (select auth.uid())
    and status in ('pending_review'::public.device_status, 'rejected'::public.device_status)
    and (select public.has_permission('devices.read_own_submissions'))
  )
);

-- Private financials: only callers with financials.read can see rows.
drop policy if exists device_financials_read_private on public.device_financials;
create policy device_financials_read_private
on public.device_financials for select to authenticated
using ((select public.has_permission('financials.read')));
-- No direct INSERT / UPDATE / DELETE policies: use the guarded RPC functions below.

-- Public selling-price projection: no purchase/discount/payback/profit fields exist here.
drop policy if exists public_pricing_read_permission on public.device_public_pricing;
create policy public_pricing_read_permission
on public.device_public_pricing for select to authenticated
using (
  (select public.has_permission('pricing.read_public'))
  or (select public.has_permission('financials.read'))
);
-- No direct write policies. Triggers keep this projection synchronized.

-- Company settings: all active users can read display settings; only admin can update.
drop policy if exists company_settings_read_active on public.company_settings;
create policy company_settings_read_active
on public.company_settings for select to authenticated
using ((select public.is_active_user()));
drop policy if exists company_settings_update_admin on public.company_settings;
create policy company_settings_update_admin
on public.company_settings for update to authenticated
using ((select public.has_permission('settings.manage')))
with check ((select public.has_permission('settings.manage')));

-- Only administrators (built-in roles.manage permission) can edit role matrix.
drop policy if exists permission_catalog_admin_read on public.permission_catalog;
create policy permission_catalog_admin_read
on public.permission_catalog for select to authenticated
using ((select public.has_permission('roles.manage')));
drop policy if exists role_permissions_admin_all on public.role_permissions;
create policy role_permissions_admin_all
on public.role_permissions for all to authenticated
using ((select public.has_permission('roles.manage')))
with check ((select public.has_permission('roles.manage')));

-- Audit log is administrator-only by default.
drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read
on public.audit_logs for select to authenticated
using ((select public.has_permission('audit.read')));

-- ---------------------------------------------------------------------------
-- 14. Role-specific, column-limited views
--     These are intentionally security-barrier views owned by the database
--     owner. Their WHERE clauses explicitly check the caller's live database
--     permissions and auth.uid(). Clients receive no direct SELECT grants on
--     the underlying device / financial tables. Do not remove these filters.
-- ---------------------------------------------------------------------------
create or replace view public.viewer_device_catalog
with (security_barrier = true)
as
select
  d.id,
  d.name,
  d.brand_id,
  b.name as brand_name,
  d.category_id,
  c.name as category_name,
  d.created_at,
  d.updated_at,
  p.final_selling_price,
  p.currency_code
from public.devices as d
join public.device_public_pricing as p on p.device_id = d.id
join public.brands as b on b.id = d.brand_id
left join public.categories as c on c.id = d.category_id
where d.status = 'active'::public.device_status
  and (public.has_permission('devices.read_public')
       or public.has_permission('devices.read_all'))
  and (public.has_permission('pricing.read_public')
       or public.has_permission('financials.read'));

create or replace view public.pricing_manager_device_catalog
with (security_barrier = true)
as
select
  d.id,
  d.name,
  d.brand_id,
  b.name as brand_name,
  d.category_id,
  c.name as category_name,
  d.sku,
  d.model_number,
  d.metadata,
  d.status,
  d.created_by,
  d.created_at,
  d.updated_at,
  f.official_purchase_price,
  f.discount_type,
  f.discount_value,
  f.discount_amount,
  f.payback_amount,
  f.final_cost_before_profit,
  f.company_profit,
  f.final_selling_price,
  s.currency_code
from public.devices as d
join public.device_financials as f on f.device_id = d.id
join public.brands as b on b.id = d.brand_id
left join public.categories as c on c.id = d.category_id
cross join public.company_settings as s
where s.id = true
  and public.has_permission('devices.read_all')
  and public.has_permission('financials.read');

-- Data Entry can see the state of its own submissions, but not the purchase
-- price it entered or any other private financial field.
create or replace view public.my_device_submissions
with (security_barrier = true)
as
select
  d.id,
  d.name,
  d.brand_id,
  b.name as brand_name,
  d.category_id,
  c.name as category_name,
  d.sku,
  d.model_number,
  d.status,
  d.created_at,
  d.updated_at
from public.devices as d
join public.brands as b on b.id = d.brand_id
left join public.categories as c on c.id = d.category_id
where d.created_by = (select auth.uid())
  and d.status in ('pending_review'::public.device_status, 'rejected'::public.device_status)
  and public.has_permission('devices.read_own_submissions');

-- ---------------------------------------------------------------------------
-- 15. Search RPCs for compound filters and full-text-like metadata matching
-- ---------------------------------------------------------------------------
create or replace function public.search_viewer_devices(
  p_search text default null,
  p_brand_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_min_selling_price numeric default null,
  p_max_selling_price numeric default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_sort text default 'newest',
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof public.viewer_device_catalog
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    d.name,
    d.brand_id,
    b.name as brand_name,
    d.category_id,
    c.name as category_name,
    d.created_at,
    d.updated_at,
    p.final_selling_price,
    p.currency_code
  from public.devices as d
  join public.device_public_pricing as p on p.device_id = d.id
  join public.brands as b on b.id = d.brand_id
  left join public.categories as c on c.id = d.category_id
  where d.status = 'active'::public.device_status
    and (public.has_permission('devices.read_public')
         or public.has_permission('devices.read_all'))
    and (public.has_permission('pricing.read_public')
         or public.has_permission('financials.read'))
    and (p_search is null or btrim(p_search) = ''
         or d.name ilike '%' || btrim(p_search) || '%'
         or b.name ilike '%' || btrim(p_search) || '%'
         or coalesce(c.name, '') ilike '%' || btrim(p_search) || '%')
    and (p_brand_ids is null or d.brand_id = any(p_brand_ids))
    and (p_category_ids is null or d.category_id = any(p_category_ids))
    and (p_min_selling_price is null or p.final_selling_price >= p_min_selling_price)
    and (p_max_selling_price is null or p.final_selling_price <= p_max_selling_price)
    and (p_created_from is null or d.created_at >= p_created_from)
    and (p_created_to is null or d.created_at <= p_created_to)
  order by
    case when coalesce(p_sort, 'newest') = 'oldest' then d.created_at end asc,
    case when coalesce(p_sort, 'newest') not in
      ('oldest', 'name_asc', 'name_desc', 'price_asc', 'price_desc')
      then d.created_at end desc,
    case when p_sort = 'name_asc' then lower(d.name) end asc,
    case when p_sort = 'name_desc' then lower(d.name) end desc,
    case when p_sort = 'price_asc' then p.final_selling_price end asc,
    case when p_sort = 'price_desc' then p.final_selling_price end desc,
    d.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.search_pricing_manager_devices(
  p_search text default null,
  p_brand_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_status public.device_status default null,
  p_min_purchase_price numeric default null,
  p_max_purchase_price numeric default null,
  p_min_final_cost numeric default null,
  p_max_final_cost numeric default null,
  p_min_profit numeric default null,
  p_max_profit numeric default null,
  p_min_selling_price numeric default null,
  p_max_selling_price numeric default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_sort text default 'newest',
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof public.pricing_manager_device_catalog
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    d.name,
    d.brand_id,
    b.name as brand_name,
    d.category_id,
    c.name as category_name,
    d.sku,
    d.model_number,
    d.metadata,
    d.status,
    d.created_by,
    d.created_at,
    d.updated_at,
    f.official_purchase_price,
    f.discount_type,
    f.discount_value,
    f.discount_amount,
    f.payback_amount,
    f.final_cost_before_profit,
    f.company_profit,
    f.final_selling_price,
    s.currency_code
  from public.devices as d
  join public.device_financials as f on f.device_id = d.id
  join public.brands as b on b.id = d.brand_id
  left join public.categories as c on c.id = d.category_id
  cross join public.company_settings as s
  where s.id = true
    and public.has_permission('devices.read_all')
    and public.has_permission('financials.read')
    and (p_search is null or btrim(p_search) = ''
         or d.name ilike '%' || btrim(p_search) || '%'
         or b.name ilike '%' || btrim(p_search) || '%'
         or coalesce(c.name, '') ilike '%' || btrim(p_search) || '%'
         or coalesce(d.sku, '') ilike '%' || btrim(p_search) || '%'
         or coalesce(d.model_number, '') ilike '%' || btrim(p_search) || '%'
         or d.metadata::text ilike '%' || btrim(p_search) || '%')
    and (p_brand_ids is null or d.brand_id = any(p_brand_ids))
    and (p_category_ids is null or d.category_id = any(p_category_ids))
    and (p_status is null or d.status = p_status)
    and (p_min_purchase_price is null or f.official_purchase_price >= p_min_purchase_price)
    and (p_max_purchase_price is null or f.official_purchase_price <= p_max_purchase_price)
    and (p_min_final_cost is null or f.final_cost_before_profit >= p_min_final_cost)
    and (p_max_final_cost is null or f.final_cost_before_profit <= p_max_final_cost)
    and (p_min_profit is null or f.company_profit >= p_min_profit)
    and (p_max_profit is null or f.company_profit <= p_max_profit)
    and (p_min_selling_price is null or f.final_selling_price >= p_min_selling_price)
    and (p_max_selling_price is null or f.final_selling_price <= p_max_selling_price)
    and (p_created_from is null or d.created_at >= p_created_from)
    and (p_created_to is null or d.created_at <= p_created_to)
  order by
    case when coalesce(p_sort, 'newest') = 'oldest' then d.created_at end asc,
    case when coalesce(p_sort, 'newest') not in
      ('oldest', 'name_asc', 'name_desc', 'purchase_asc', 'purchase_desc',
       'cost_asc', 'cost_desc', 'profit_asc', 'profit_desc',
       'selling_asc', 'selling_desc') then d.created_at end desc,
    case when p_sort = 'name_asc' then lower(d.name) end asc,
    case when p_sort = 'name_desc' then lower(d.name) end desc,
    case when p_sort = 'purchase_asc' then f.official_purchase_price end asc,
    case when p_sort = 'purchase_desc' then f.official_purchase_price end desc,
    case when p_sort = 'cost_asc' then f.final_cost_before_profit end asc,
    case when p_sort = 'cost_desc' then f.final_cost_before_profit end desc,
    case when p_sort = 'profit_asc' then f.company_profit end asc,
    case when p_sort = 'profit_desc' then f.company_profit end desc,
    case when p_sort = 'selling_asc' then f.final_selling_price end asc,
    case when p_sort = 'selling_desc' then f.final_selling_price end desc,
    d.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- 16. Secure RPC: Data Entry submits a pending device and purchase price
-- ---------------------------------------------------------------------------
create or replace function public.submit_device(
  p_name text,
  p_brand_id uuid,
  p_category_id uuid,
  p_official_purchase_price numeric,
  p_sku text default null,
  p_model_number text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_device_id uuid;
begin
  if v_user_id is null or not public.has_permission('devices.submit') then
    raise exception 'Not authorized to submit devices.' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Device name is required.';
  end if;
  if p_official_purchase_price is null or p_official_purchase_price < 0 then
    raise exception 'A non-negative official purchase price is required.';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Metadata must be a JSON object.';
  end if;
  if not exists (
    select 1 from public.brands b
    where b.id = p_brand_id and b.is_active = true
  ) then
    raise exception 'Selected brand does not exist or is inactive.';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.is_active = true
  ) then
    raise exception 'Selected category does not exist or is inactive.';
  end if;

  insert into public.devices (
    name, brand_id, category_id, sku, model_number, metadata,
    status, created_by, updated_by
  ) values (
    btrim(p_name), p_brand_id, p_category_id, nullif(btrim(p_sku), ''),
    nullif(btrim(p_model_number), ''), p_metadata,
    'pending_review'::public.device_status, v_user_id, v_user_id
  ) returning id into v_device_id;

  -- Data Entry may enter the purchase price, but cannot read this row.
  insert into public.device_financials (
    device_id, official_purchase_price, discount_type, discount_value,
    payback_amount, company_profit, updated_by
  ) values (
    v_device_id, p_official_purchase_price, 'percentage'::public.discount_type,
    0, 0, 0, v_user_id
  );

  return v_device_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Secure RPC: Manager/Admin create a fully priced device
-- ---------------------------------------------------------------------------
create or replace function public.create_managed_device(
  p_name text,
  p_brand_id uuid,
  p_category_id uuid,
  p_official_purchase_price numeric,
  p_discount_type public.discount_type,
  p_discount_value numeric,
  p_payback_amount numeric,
  p_company_profit numeric,
  p_sku text default null,
  p_model_number text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_status public.device_status default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_device_id uuid;
begin
  if v_user_id is null
     or not public.has_permission('devices.create')
     or not public.has_permission('financials.update') then
    raise exception 'Not authorized to create fully priced devices.' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Device name is required.';
  end if;
  if p_status not in ('active'::public.device_status, 'draft'::public.device_status,
                       'pending_review'::public.device_status) then
    raise exception 'New devices can only be active, draft, or pending review.';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Metadata must be a JSON object.';
  end if;
  if not exists (
    select 1 from public.brands b
    where b.id = p_brand_id and b.is_active = true
  ) then
    raise exception 'Selected brand does not exist or is inactive.';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.is_active = true
  ) then
    raise exception 'Selected category does not exist or is inactive.';
  end if;

  insert into public.devices (
    name, brand_id, category_id, sku, model_number, metadata,
    status, created_by, updated_by
  ) values (
    btrim(p_name), p_brand_id, p_category_id, nullif(btrim(p_sku), ''),
    nullif(btrim(p_model_number), ''), p_metadata,
    p_status, v_user_id, v_user_id
  ) returning id into v_device_id;

  insert into public.device_financials (
    device_id, official_purchase_price, discount_type, discount_value,
    payback_amount, company_profit, updated_by
  ) values (
    v_device_id, p_official_purchase_price, p_discount_type, p_discount_value,
    p_payback_amount, p_company_profit, v_user_id
  );

  return v_device_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. Secure RPC: update device descriptive fields
-- ---------------------------------------------------------------------------
create or replace function public.update_device_details(
  p_device_id uuid,
  p_name text,
  p_brand_id uuid,
  p_category_id uuid,
  p_sku text,
  p_model_number text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('devices.update') then
    raise exception 'Not authorized to edit device details.' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Device name is required.';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Metadata must be a JSON object.';
  end if;
  if not exists (select 1 from public.brands b where b.id = p_brand_id and b.is_active = true) then
    raise exception 'Selected brand does not exist or is inactive.';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories c where c.id = p_category_id and c.is_active = true
  ) then
    raise exception 'Selected category does not exist or is inactive.';
  end if;

  update public.devices
  set name = btrim(p_name),
      brand_id = p_brand_id,
      category_id = p_category_id,
      sku = nullif(btrim(p_sku), ''),
      model_number = nullif(btrim(p_model_number), ''),
      metadata = p_metadata,
      updated_by = (select auth.uid())
  where id = p_device_id;

  if not found then
    raise exception 'Device was not found.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 19. Secure RPC: update all financial inputs (calculated fields are trigger-owned)
-- ---------------------------------------------------------------------------
create or replace function public.update_device_financials(
  p_device_id uuid,
  p_official_purchase_price numeric,
  p_discount_type public.discount_type,
  p_discount_value numeric,
  p_payback_amount numeric,
  p_company_profit numeric
)
returns table (
  discount_amount numeric(18,2),
  final_cost_before_profit numeric(18,2),
  final_selling_price numeric(18,2)
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('financials.update') then
    raise exception 'Not authorized to edit financial values.' using errcode = '42501';
  end if;

  update public.device_financials as f
  set official_purchase_price = p_official_purchase_price,
      discount_type = p_discount_type,
      discount_value = p_discount_value,
      payback_amount = p_payback_amount,
      company_profit = p_company_profit,
      updated_by = (select auth.uid())
  where f.device_id = p_device_id;

  if not found then
    raise exception 'Financial record was not found for this device.';
  end if;

  return query
  select f.discount_amount, f.final_cost_before_profit, f.final_selling_price
  from public.device_financials as f
  where f.device_id = p_device_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 20. Secure RPC: approve, reject, reactivate, or archive device
-- ---------------------------------------------------------------------------
create or replace function public.set_device_status(
  p_device_id uuid,
  p_status public.device_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status = 'archived'::public.device_status then
    if not public.has_permission('devices.archive') then
      raise exception 'Not authorized to archive devices.' using errcode = '42501';
    end if;
  else
    if not public.has_permission('devices.update') then
      raise exception 'Not authorized to change device status.' using errcode = '42501';
    end if;
  end if;

  if p_status in ('active'::public.device_status, 'rejected'::public.device_status)
     and not public.has_permission('submissions.review') then
    raise exception 'Not authorized to review submissions.' using errcode = '42501';
  end if;

  if p_status = 'active'::public.device_status and not exists (
    select 1 from public.device_financials f where f.device_id = p_device_id
  ) then
    raise exception 'A financial record is required before activating a device.';
  end if;

  update public.devices
  set status = p_status,
      updated_by = (select auth.uid())
  where id = p_device_id;

  if not found then
    raise exception 'Device was not found.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 21. Secure RPC: user administration
--     Only the Administrator role can assign roles or activate/deactivate users.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_role(
  p_target_user_id uuid,
  p_new_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_role public.app_role;
  v_old_data jsonb;
  v_new_data jsonb;
  v_other_admins bigint;
begin
  if public.current_app_role() is distinct from 'administrator'::public.app_role then
    raise exception 'Only an Administrator can change user roles.' using errcode = '42501';
  end if;
  if p_new_role is null then
    raise exception 'A role must be selected.';
  end if;

  select p.role, to_jsonb(p)
    into v_old_role, v_old_data
  from public.profiles p
  where p.id = p_target_user_id
  for update;

  if not found then
    raise exception 'User profile was not found. The user must first exist in Supabase Auth.';
  end if;

  if v_old_role = 'administrator'::public.app_role
     and p_new_role <> 'administrator'::public.app_role then
    select count(*) into v_other_admins
    from public.profiles p
    where p.role = 'administrator'::public.app_role
      and p.is_active = true
      and p.id <> p_target_user_id;
    if v_other_admins = 0 then
      raise exception 'Cannot demote the last active Administrator.';
    end if;
  end if;

  update public.profiles
  set role = p_new_role,
      updated_at = now()
  where id = p_target_user_id;

  select to_jsonb(p) into v_new_data
  from public.profiles p where p.id = p_target_user_id;

  insert into public.audit_logs (
    actor_id, action, table_name, record_id, old_data, new_data
  ) values (
    (select auth.uid()), 'ROLE_CHANGED', 'profiles', p_target_user_id,
    v_old_data, v_new_data
  );
end;
$$;

create or replace function public.admin_set_user_active(
  p_target_user_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_data jsonb;
  v_new_data jsonb;
  v_target_role public.app_role;
  v_other_admins bigint;
begin
  if public.current_app_role() is distinct from 'administrator'::public.app_role then
    raise exception 'Only an Administrator can activate or deactivate users.' using errcode = '42501';
  end if;
  if p_target_user_id = (select auth.uid()) and p_is_active = false then
    raise exception 'You cannot deactivate your own currently signed-in Administrator account.';
  end if;

  select p.role, to_jsonb(p)
    into v_target_role, v_old_data
  from public.profiles p
  where p.id = p_target_user_id
  for update;

  if not found then
    raise exception 'User profile was not found.';
  end if;

  if v_target_role = 'administrator'::public.app_role and p_is_active = false then
    select count(*) into v_other_admins
    from public.profiles p
    where p.role = 'administrator'::public.app_role
      and p.is_active = true
      and p.id <> p_target_user_id;
    if v_other_admins = 0 then
      raise exception 'Cannot deactivate the last active Administrator.';
    end if;
  end if;

  update public.profiles
  set is_active = p_is_active,
      updated_at = now()
  where id = p_target_user_id;

  select to_jsonb(p) into v_new_data
  from public.profiles p where p.id = p_target_user_id;

  insert into public.audit_logs (
    actor_id, action, table_name, record_id, old_data, new_data
  ) values (
    (select auth.uid()),
    case when p_is_active then 'USER_ACTIVATED' else 'USER_DEACTIVATED' end,
    'profiles', p_target_user_id, v_old_data, v_new_data
  );
end;
$$;

create or replace function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_active_user() then
    raise exception 'An active authenticated account is required.' using errcode = '42501';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'Name must contain at least two characters.';
  end if;

  update public.profiles
  set full_name = btrim(p_full_name),
      updated_at = now()
  where id = (select auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 22. Views, table grants, and function grants
--     Grants and policies are both required. Protected base tables have no
--     client SELECT grants; role-specific views explicitly check permissions.
-- ---------------------------------------------------------------------------
revoke all on public.profiles from public, anon, authenticated;
revoke all on public.brands from public, anon, authenticated;
revoke all on public.categories from public, anon, authenticated;
revoke all on public.devices from public, anon, authenticated;
revoke all on public.device_financials from public, anon, authenticated;
revoke all on public.device_public_pricing from public, anon, authenticated;
revoke all on public.company_settings from public, anon, authenticated;
revoke all on public.permission_catalog from public, anon, authenticated;
revoke all on public.role_permissions from public, anon, authenticated;
revoke all on public.audit_logs from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on type public.app_role, public.discount_type, public.device_status to authenticated;

-- Read privileges are granted only where needed; RLS narrows the rows.
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.brands to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
-- No direct SELECT grant on devices: use the role-specific views.
-- No direct SELECT grant on private financials: use the manager-only view.
-- No direct SELECT grant on the public-price projection: use the Viewer view.
grant select, update on public.company_settings to authenticated;
grant select on public.permission_catalog to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant select on public.audit_logs to authenticated;

revoke all on public.viewer_device_catalog from public, anon, authenticated;
revoke all on public.pricing_manager_device_catalog from public, anon, authenticated;
revoke all on public.my_device_submissions from public, anon, authenticated;
grant select on public.viewer_device_catalog to authenticated;
grant select on public.pricing_manager_device_catalog to authenticated;
grant select on public.my_device_submissions to authenticated;

-- Revoke default PUBLIC execution, then grant only intended RPC/helper access.
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_active_user() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
revoke all on function public.search_viewer_devices(text, uuid[], uuid[], numeric, numeric, timestamptz, timestamptz, text, integer, integer) from public, anon;
revoke all on function public.search_pricing_manager_devices(text, uuid[], uuid[], public.device_status, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, timestamptz, timestamptz, text, integer, integer) from public, anon;
revoke all on function public.submit_device(text, uuid, uuid, numeric, text, text, jsonb) from public, anon;
revoke all on function public.create_managed_device(text, uuid, uuid, numeric, public.discount_type, numeric, numeric, numeric, text, text, jsonb, public.device_status) from public, anon;
revoke all on function public.update_device_details(uuid, text, uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.update_device_financials(uuid, numeric, public.discount_type, numeric, numeric, numeric) from public, anon;
revoke all on function public.set_device_status(uuid, public.device_status) from public, anon;
revoke all on function public.admin_set_user_role(uuid, public.app_role) from public, anon;
revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon;
revoke all on function public.update_my_profile(text) from public, anon;

-- RLS policies call these helpers, so authenticated users need EXECUTE.
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

grant execute on function public.search_viewer_devices(text, uuid[], uuid[], numeric, numeric, timestamptz, timestamptz, text, integer, integer) to authenticated;
grant execute on function public.search_pricing_manager_devices(text, uuid[], uuid[], public.device_status, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, timestamptz, timestamptz, text, integer, integer) to authenticated;
grant execute on function public.submit_device(text, uuid, uuid, numeric, text, text, jsonb) to authenticated;
grant execute on function public.create_managed_device(text, uuid, uuid, numeric, public.discount_type, numeric, numeric, numeric, text, text, jsonb, public.device_status) to authenticated;
grant execute on function public.update_device_details(uuid, text, uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.update_device_financials(uuid, numeric, public.discount_type, numeric, numeric, numeric) to authenticated;
grant execute on function public.set_device_status(uuid, public.device_status) to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.update_my_profile(text) to authenticated;

-- Trigger functions are not application RPC endpoints.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_auth_user_profile() from public, anon, authenticated;
revoke all on function public.calculate_device_financials() from public, anon, authenticated;
revoke all on function public.sync_device_public_pricing() from public, anon, authenticated;
revoke all on function public.sync_public_price_currency() from public, anon, authenticated;
revoke all on function public.recalculate_financials_on_currency_scale_change() from public, anon, authenticated;
revoke all on function public.write_audit_log() from public, anon, authenticated;
