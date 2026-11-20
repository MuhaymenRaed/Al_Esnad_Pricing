-- ============================================================================
-- AL-ESNAD · Application extensions (runs AFTER 20261116130000_alesnad_backend)
--
-- Purely additive: adds columns, helper functions and RPCs the web app needs,
-- and closes two security gaps found while reviewing the baseline. Safe to run
-- in the Supabase SQL Editor on the already-deployed project. Idempotent.
--
--   1. Preference / presentation columns
--   2. Hardening
--        a. Self-registered accounts start INACTIVE (only invited accounts are
--           active), so a mis-configured "allow sign-ups" setting can no
--           longer expose selling prices to strangers.
--        b. Mandatory role separation in the permission matrix: Viewers and
--           Data Entry operators can never be granted financial or
--           administrative permissions; Pricing Managers keep their core
--           pricing access and never receive user/role/settings/audit rights.
--   3. Search engine (keyset pagination, multi-token + fuzzy search, facets,
--      statistics) for the full financial and Viewer projections
--   4. Session context, dashboards, brands, preferences, atomic device save,
--      submission edits, invitation audit entries
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists theme_preference text not null default 'system'
    check (theme_preference in ('light', 'dark', 'system')),
  add column if not exists locale text not null default 'en'
    check (locale in ('en', 'ar'));

alter table public.brands
  add column if not exists accent_color text
    check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists sort_order integer not null default 0;

alter table public.company_settings
  add column if not exists company_tagline text
    check (company_tagline is null or char_length(company_tagline) <= 200),
  add column if not exists report_footer text
    check (report_footer is null or char_length(report_footer) <= 300),
  add column if not exists idle_timeout_minutes smallint not null default 60
    check (idle_timeout_minutes between 5 and 1440),
  add column if not exists default_locale text not null default 'en'
    check (default_locale in ('en', 'ar'));

-- Search-friendly ordering indexes used by keyset pagination.
create index if not exists devices_name_sort_idx on public.devices (lower(name), id);
create index if not exists devices_created_sort_idx on public.devices (created_at, id);
create index if not exists devices_updated_sort_idx on public.devices (updated_at, id);

-- ---------------------------------------------------------------------------
-- 2a. Only invited accounts are active on creation
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
    -- Supabase sets invited_at for accounts created by inviteUserByEmail().
    -- Anything else (open sign-up, manual creation) waits for an admin.
    new.invited_at is not null
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

revoke all on function public.handle_auth_user_profile() from public, anon, authenticated;

-- Nobody changes their own role or activation state (not even an admin; another
-- administrator must do it). Trusted contexts without a JWT are unaffected.
create or replace function private.guard_self_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.id
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own role or account status.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_self_profile_change() from public;

drop trigger if exists profiles_guard_self_change on public.profiles;
create trigger profiles_guard_self_change
before update of role, is_active on public.profiles
for each row execute function private.guard_self_profile_change();

-- ---------------------------------------------------------------------------
-- 2b. Locked cells of the permission matrix
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (permission_key, description, permission_group)
values
  ('roles.preview', 'Preview the Viewer and Data Entry interfaces ("View As").', 'users'),
  ('devices.edit_own_submissions', 'Edit own submissions while they await review.', 'devices')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role, permission_key, allowed)
values ('pricing_manager', 'roles.preview', true)
on conflict (role, permission_key) do nothing;

-- Returns the forced value of a matrix cell, or NULL when it is configurable.
create or replace function private.locked_permission_value(p_role public.app_role, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role = 'administrator' then true
    when p_role in ('viewer', 'data_entry') and p_key in (
      'devices.read_all', 'devices.create', 'devices.update', 'devices.archive',
      'financials.read', 'financials.update', 'submissions.review', 'roles.preview',
      'users.manage', 'roles.manage', 'audit.read', 'settings.manage'
    ) then false
    when p_role = 'pricing_manager' and p_key in (
      'devices.read_all', 'financials.read', 'financials.update'
    ) then true
    when p_role = 'pricing_manager' and p_key in (
      'users.manage', 'roles.manage', 'audit.read', 'settings.manage'
    ) then false
    else null
  end;
$$;

create or replace function private.guard_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   public.app_role := coalesce(new.role, old.role);
  v_key    text := coalesce(new.permission_key, old.permission_key);
  v_forced boolean := private.locked_permission_value(v_role, v_key);
begin
  -- Trusted contexts (migrations, service role) are not restricted.
  if (select auth.uid()) is null or v_forced is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if v_forced then
      raise exception 'Permission % is locked for role %', v_key, v_role using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.role <> old.role or new.permission_key <> old.permission_key) then
    raise exception 'Permission rows cannot be re-keyed' using errcode = '42501';
  end if;

  if new.allowed is distinct from v_forced then
    raise exception 'Permission % is locked for role % to preserve mandatory role separation', v_key, v_role
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_role_permissions() from public;

drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard
before insert or update or delete on public.role_permissions
for each row execute function private.guard_role_permissions();

-- Repair any existing cell that violates the separation (no-op on a fresh DB).
delete from public.role_permissions rp
where private.locked_permission_value(rp.role, rp.permission_key) = false and rp.allowed;

-- ---------------------------------------------------------------------------
-- 3. Search engine (shared by the full and Viewer projections)
-- ---------------------------------------------------------------------------
create or replace function private.like_pattern(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

create or replace function private.jsonb_text_array(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'array' then null
    else array(select jsonb_array_elements_text(p_value))
  end;
$$;

create or replace function private.device_price_column(p_field text, p_full boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not p_full then
    if coalesce(p_field, 'selling') <> 'selling' then
      raise exception 'Price field "%" is not available for this projection', p_field using errcode = '42501';
    end if;
    return 'pp.final_selling_price';
  end if;
  return case coalesce(p_field, 'selling')
    when 'selling'  then 'f.final_selling_price'
    when 'purchase' then 'f.official_purchase_price'
    when 'cost'     then 'f.final_cost_before_profit'
    when 'profit'   then 'f.company_profit'
    when 'discount' then 'f.discount_amount'
    when 'payback'  then 'f.payback_amount'
  end;
end;
$$;

-- Filter document keys (all optional): q, brandIds[], categoryIds[], ids[],
-- statuses[] (full only), priceField, priceMin, priceMax, createdFrom,
-- createdTo, updatedFrom, updatedTo. User input only reaches SQL through
-- typed casts or format('%L').
create or replace function private.device_filter_sql(p_filters jsonb, p_full boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  f          jsonb := coalesce(p_filters, '{}'::jsonb);
  w          text[] := array['true'::text];
  v_q        text;
  v_tok      text;
  v_parts    text[] := '{}';
  v_clause   text;
  v_numtxt   text;
  v_price    text;
  v_uuids    uuid[];
  v_statuses public.device_status[];
begin
  if jsonb_typeof(f) <> 'object' then
    raise exception 'Filters must be a JSON object' using errcode = '22023';
  end if;

  if p_full then
    v_statuses := private.jsonb_text_array(f -> 'statuses')::public.device_status[];
    if v_statuses is not null and cardinality(v_statuses) > 0 then
      w := w || format('d.status = any(%L::public.device_status[])', v_statuses);
    else
      w := w || 'd.status <> ''archived'''::text;
    end if;
  else
    w := w || 'd.status = ''active'' and b.is_active'::text;
  end if;

  v_uuids := private.jsonb_text_array(f -> 'brandIds')::uuid[];
  if v_uuids is not null and cardinality(v_uuids) > 0 then
    w := w || format('d.brand_id = any(%L::uuid[])', v_uuids);
  end if;

  v_uuids := private.jsonb_text_array(f -> 'categoryIds')::uuid[];
  if v_uuids is not null and cardinality(v_uuids) > 0 then
    w := w || format('d.category_id = any(%L::uuid[])', v_uuids);
  end if;

  v_uuids := private.jsonb_text_array(f -> 'ids')::uuid[];
  if v_uuids is not null then
    if cardinality(v_uuids) > 10000 then
      raise exception 'Too many selected devices' using errcode = '22023';
    end if;
    w := w || format('d.id = any(%L::uuid[])', v_uuids);
  end if;

  -- Every token must match an authorised text field (partial, case-insensitive);
  -- numeric tokens also match authorised amounts; 4+ character tokens accept a
  -- close trigram match against the device name (typo tolerance).
  v_q := left(btrim(coalesce(f ->> 'q', '')), 120);
  if v_q <> '' then
    for v_tok in
      select t from regexp_split_to_table(lower(v_q), '\s+') as t where t <> '' limit 8
    loop
      if p_full then
        v_clause := format(
          'd.name ilike %1$L or b.name ilike %1$L or c.name ilike %1$L or d.sku ilike %1$L'
          ' or d.model_number ilike %1$L or d.metadata::text ilike %1$L',
          private.like_pattern(v_tok));
      else
        v_clause := format(
          'd.name ilike %1$L or b.name ilike %1$L or c.name ilike %1$L',
          private.like_pattern(v_tok));
      end if;

      v_numtxt := replace(v_tok, ',', '');
      if v_numtxt ~ '^\d{1,15}(\.\d{1,4})?$' then
        if p_full then
          v_clause := v_clause || format(
            ' or f.official_purchase_price = %1$L::numeric or f.final_selling_price = %1$L::numeric'
            ' or f.final_cost_before_profit = %1$L::numeric or f.company_profit = %1$L::numeric'
            ' or f.discount_amount = %1$L::numeric or f.payback_amount = %1$L::numeric',
            v_numtxt::numeric);
        else
          v_clause := v_clause || format(' or pp.final_selling_price = %L::numeric', v_numtxt::numeric);
        end if;
      end if;

      if char_length(v_tok) >= 4 then
        v_clause := v_clause || format(' or extensions.word_similarity(%L, lower(d.name)) >= 0.6', v_tok);
      end if;

      v_parts := v_parts || ('(' || v_clause || ')');
    end loop;
    w := w || ('(' || array_to_string(v_parts, ' and ') || ')');
  end if;

  if nullif(f ->> 'priceMin', '') is not null or nullif(f ->> 'priceMax', '') is not null then
    v_price := private.device_price_column(f ->> 'priceField', p_full);
    if v_price is null then
      raise exception 'Unknown price field "%"', f ->> 'priceField' using errcode = '22023';
    end if;
    if nullif(f ->> 'priceMin', '') is not null then
      w := w || format('%s >= %L::numeric', v_price, (f ->> 'priceMin')::numeric);
    end if;
    if nullif(f ->> 'priceMax', '') is not null then
      w := w || format('%s <= %L::numeric', v_price, (f ->> 'priceMax')::numeric);
    end if;
  end if;

  if nullif(f ->> 'createdFrom', '') is not null then
    w := w || format('d.created_at >= %L::timestamptz', (f ->> 'createdFrom')::timestamptz);
  end if;
  if nullif(f ->> 'createdTo', '') is not null then
    w := w || format('d.created_at < %L::timestamptz', (f ->> 'createdTo')::timestamptz);
  end if;
  if nullif(f ->> 'updatedFrom', '') is not null then
    w := w || format('d.updated_at >= %L::timestamptz', (f ->> 'updatedFrom')::timestamptz);
  end if;
  if nullif(f ->> 'updatedTo', '') is not null then
    w := w || format('d.updated_at < %L::timestamptz', (f ->> 'updatedTo')::timestamptz);
  end if;

  return array_to_string(w, ' and ');
end;
$$;

create or replace function private.device_from_sql(p_full boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_full then
    'public.devices d
       join public.brands b on b.id = d.brand_id
       left join public.categories c on c.id = d.category_id
       left join public.device_financials f on f.device_id = d.id'
  else
    'public.devices d
       join public.brands b on b.id = d.brand_id
       left join public.categories c on c.id = d.category_id
       join public.device_public_pricing pp on pp.device_id = d.id'
  end;
$$;

create or replace function private.run_device_search(
  p_filters jsonb, p_sort text, p_cursor jsonb, p_limit integer, p_full boolean
)
returns table (
  id uuid, name text,
  brand_id uuid, brand_name text, brand_color text,
  category_id uuid, category_name text,
  sku text, model_number text, metadata jsonb,
  status public.device_status,
  created_at timestamptz, updated_at timestamptz, created_by uuid,
  official_purchase_price numeric, discount_type public.discount_type, discount_value numeric,
  discount_amount numeric, payback_amount numeric, final_cost_before_profit numeric,
  company_profit numeric, final_selling_price numeric,
  sort_value text, total_count bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_where  text := private.device_filter_sql(p_filters, p_full);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_sort   text := coalesce(nullif(p_sort, ''), 'name_asc');
  v_price  text := case when p_full then 'f.final_selling_price' else 'pp.final_selling_price' end;
  v_expr   text;
  v_type   text := 'numeric';
  v_desc   boolean;
  v_dir    text;
  v_text   text;
  v_cursor text := '';
  v_select text;
begin
  case v_sort
    when 'name_asc'   then v_expr := 'lower(d.name)'; v_type := 'text'; v_desc := false;
    when 'name_desc'  then v_expr := 'lower(d.name)'; v_type := 'text'; v_desc := true;
    when 'newest'     then v_expr := 'd.created_at'; v_type := 'timestamptz'; v_desc := true;
    when 'oldest'     then v_expr := 'd.created_at'; v_type := 'timestamptz'; v_desc := false;
    when 'updated'    then v_expr := 'd.updated_at'; v_type := 'timestamptz'; v_desc := true;
    when 'price_asc'  then v_expr := format('coalesce(%s, 1e15)', v_price); v_desc := false;
    when 'price_desc' then v_expr := format('coalesce(%s, -1)', v_price); v_desc := true;
    else
      if not p_full then
        raise exception 'Sort "%" is not available for this projection', v_sort using errcode = '42501';
      end if;
      case v_sort
        when 'purchase_asc'  then v_expr := 'coalesce(f.official_purchase_price, 1e15)'; v_desc := false;
        when 'purchase_desc' then v_expr := 'coalesce(f.official_purchase_price, -1)'; v_desc := true;
        when 'cost_asc'      then v_expr := 'coalesce(f.final_cost_before_profit, 1e15)'; v_desc := false;
        when 'cost_desc'     then v_expr := 'coalesce(f.final_cost_before_profit, -1)'; v_desc := true;
        when 'profit_asc'    then v_expr := 'coalesce(f.company_profit, 1e15)'; v_desc := false;
        when 'profit_desc'   then v_expr := 'coalesce(f.company_profit, -1)'; v_desc := true;
        else raise exception 'Unknown sort "%"', v_sort using errcode = '22023';
      end case;
  end case;

  v_dir := case when v_desc then 'desc' else 'asc' end;
  v_text := case v_type
    when 'timestamptz' then format('to_char(%s at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')', v_expr)
    else format('(%s)::text', v_expr)
  end;

  if p_cursor is not null and jsonb_typeof(p_cursor) = 'object' and p_cursor ? 'id' then
    v_cursor := format(' and (%s, d.id) %s (%L::%s, %L::uuid)',
      v_expr, case when v_desc then '<' else '>' end,
      p_cursor ->> 'v', v_type, (p_cursor ->> 'id')::uuid);
  end if;

  if p_full then
    v_select := 'd.id, d.name, d.brand_id, b.name, b.accent_color, d.category_id, c.name,
                 d.sku, d.model_number, d.metadata, d.status, d.created_at, d.updated_at, d.created_by,
                 f.official_purchase_price, f.discount_type, f.discount_value, f.discount_amount,
                 f.payback_amount, f.final_cost_before_profit, f.company_profit, f.final_selling_price';
  else
    -- Viewer projection: private columns are not selected at all.
    v_select := 'd.id, d.name, d.brand_id, b.name, b.accent_color, d.category_id, c.name,
                 null::text, null::text, null::jsonb, d.status, d.created_at, d.updated_at, null::uuid,
                 null::numeric, null::public.discount_type, null::numeric, null::numeric,
                 null::numeric, null::numeric, null::numeric, pp.final_selling_price';
  end if;

  return query execute format(
    'select %s, %s, %s from %s where %s%s order by %s %s, d.id %s limit %s',
    v_select, v_text,
    case when v_cursor = '' then 'count(*) over ()' else 'null::bigint' end,
    private.device_from_sql(p_full), v_where, v_cursor, v_expr, v_dir, v_dir, v_limit);
end;
$$;

create or replace function private.run_device_summary(p_filters jsonb, p_full boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_from   text := private.device_from_sql(p_full);
  v_stats  jsonb;
  v_brands jsonb;
  v_cats   jsonb;
  v_status jsonb := '[]'::jsonb;
begin
  if p_full then
    execute format($q$
      select jsonb_build_object(
        'count', count(*),
        'pending_count', count(*) filter (where d.status = 'pending_review'),
        'active_count', count(*) filter (where d.status = 'active'),
        'min_price', min(f.final_selling_price),
        'max_price', max(f.final_selling_price),
        'avg_price', round(avg(f.final_selling_price), 2),
        'total_purchase', coalesce(sum(f.official_purchase_price), 0),
        'total_discount', coalesce(sum(f.discount_amount), 0),
        'total_payback', coalesce(sum(f.payback_amount), 0),
        'total_cost', coalesce(sum(f.final_cost_before_profit), 0),
        'total_profit', coalesce(sum(f.company_profit), 0),
        'total_selling', coalesce(sum(f.final_selling_price), 0),
        'avg_margin_pct', case when sum(f.final_selling_price) > 0
          then round(sum(f.company_profit) * 100 / sum(f.final_selling_price), 2) end,
        'brand_count', count(distinct d.brand_id)
      ) from %s where %s$q$, v_from, private.device_filter_sql(f, true))
    into v_stats;

    execute format($q$
      select coalesce(jsonb_agg(jsonb_build_object('value', s.status, 'count', s.n) order by s.status), '[]')
      from (select d.status, count(*) n from %s where %s group by d.status) s$q$,
      v_from,
      private.device_filter_sql((f - 'statuses') || '{"statuses":["draft","pending_review","active","rejected","archived"]}'::jsonb, true))
    into v_status;
  else
    execute format($q$
      select jsonb_build_object(
        'count', count(*),
        'min_price', min(pp.final_selling_price),
        'max_price', max(pp.final_selling_price),
        'avg_price', round(avg(pp.final_selling_price), 2),
        'brand_count', count(distinct d.brand_id)
      ) from %s where %s$q$, v_from, private.device_filter_sql(f, false))
    into v_stats;
  end if;

  execute format($q$
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.name, 'color', s.color, 'count', s.n)
                              order by s.n desc, s.name), '[]')
    from (select b.id, b.name, b.accent_color color, count(*) n from %s where %s
          group by b.id, b.name, b.accent_color) s$q$,
    v_from, private.device_filter_sql(f - 'brandIds', p_full))
  into v_brands;

  execute format($q$
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.name, 'count', s.n)
                              order by s.n desc, s.name), '[]')
    from (select c.id, c.name, count(*) n from %s where %s and c.id is not null
          group by c.id, c.name) s$q$,
    v_from, private.device_filter_sql(f - 'categoryIds', p_full))
  into v_cats;

  return jsonb_build_object('stats', v_stats, 'brands', v_brands, 'categories', v_cats, 'statuses', v_status);
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'private.locked_permission_value(public.app_role, text)',
    'private.like_pattern(text)',
    'private.jsonb_text_array(jsonb)',
    'private.device_price_column(text, boolean)',
    'private.device_filter_sql(jsonb, boolean)',
    'private.device_from_sql(boolean)',
    'private.run_device_search(jsonb, text, jsonb, integer, boolean)',
    'private.run_device_summary(jsonb, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3b. Projection gates
-- ---------------------------------------------------------------------------
create or replace function private.can_read_full()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('devices.read_all') and public.has_permission('financials.read');
$$;

create or replace function private.can_read_catalog()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Same rule as the baseline viewer_device_catalog view.
  select (public.has_permission('devices.read_public') or public.has_permission('devices.read_all'))
     and (public.has_permission('pricing.read_public') or public.has_permission('financials.read'));
$$;

revoke all on function private.can_read_full() from public, anon, authenticated;
revoke all on function private.can_read_catalog() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Public RPC API
-- ---------------------------------------------------------------------------

-- Full financial projection (Administrator / Pricing Manager).
create or replace function public.search_devices(
  p_filters jsonb default '{}'::jsonb,
  p_sort    text default 'name_asc',
  p_cursor  jsonb default null,
  p_limit   integer default 50
)
returns table (
  id uuid, name text,
  brand_id uuid, brand_name text, brand_color text,
  category_id uuid, category_name text,
  sku text, model_number text, metadata jsonb,
  status public.device_status,
  created_at timestamptz, updated_at timestamptz, created_by uuid,
  official_purchase_price numeric, discount_type public.discount_type, discount_value numeric,
  discount_amount numeric, payback_amount numeric, final_cost_before_profit numeric,
  company_profit numeric, final_selling_price numeric,
  sort_value text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_full() then
    raise exception 'Not authorized to read private device financials.' using errcode = '42501';
  end if;
  return query select * from private.run_device_search(p_filters, p_sort, p_cursor, p_limit, true);
end;
$$;

create or replace function public.device_summary(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_full() then
    raise exception 'Not authorized to read private device financials.' using errcode = '42501';
  end if;
  return private.run_device_summary(p_filters, true);
end;
$$;

-- Viewer projection: ONLY name, brand, category and approved selling price.
create or replace function public.search_catalog(
  p_filters jsonb default '{}'::jsonb,
  p_sort    text default 'name_asc',
  p_cursor  jsonb default null,
  p_limit   integer default 50
)
returns table (
  id uuid, name text,
  brand_id uuid, brand_name text, brand_color text,
  category_id uuid, category_name text,
  final_selling_price numeric,
  created_at timestamptz, updated_at timestamptz,
  sort_value text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_catalog() then
    raise exception 'Not authorized to read the device catalogue.' using errcode = '42501';
  end if;
  return query
    select r.id, r.name, r.brand_id, r.brand_name, r.brand_color, r.category_id, r.category_name,
           r.final_selling_price, r.created_at, r.updated_at, r.sort_value, r.total_count
    from private.run_device_search(p_filters, p_sort, p_cursor, p_limit, false) r;
end;
$$;

create or replace function public.catalog_summary(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_catalog() then
    raise exception 'Not authorized to read the device catalogue.' using errcode = '42501';
  end if;
  return private.run_device_summary(p_filters, false);
end;
$$;

-- Data Entry: own submissions (no financial fields, as in the baseline view).
create or replace function public.my_submissions(
  p_search text default null,
  p_status public.device_status default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, name text, brand_id uuid, brand_name text, brand_color text,
  category_id uuid, category_name text, sku text, model_number text, metadata jsonb,
  status public.device_status, created_at timestamptz, updated_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('devices.read_own_submissions') or public.has_permission('devices.submit')) then
    raise exception 'Not authorized to read submissions.' using errcode = '42501';
  end if;
  return query
    select d.id, d.name, d.brand_id, b.name, b.accent_color, d.category_id, c.name,
           d.sku, d.model_number, d.metadata, d.status, d.created_at, d.updated_at, count(*) over ()
    from public.devices d
    join public.brands b on b.id = d.brand_id
    left join public.categories c on c.id = d.category_id
    where d.created_by = (select auth.uid())
      and d.status <> 'archived'
      and (p_status is null or d.status = p_status)
      and (nullif(btrim(p_search), '') is null
           or d.name ilike private.like_pattern(btrim(p_search))
           or b.name ilike private.like_pattern(btrim(p_search))
           or d.sku ilike private.like_pattern(btrim(p_search)))
    order by d.created_at desc, d.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 1000)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Data Entry: edit an own submission awaiting review (re-submits rejected ones).
create or replace function public.update_my_submission(
  p_id uuid,
  p_name text,
  p_brand_id uuid,
  p_category_id uuid,
  p_official_purchase_price numeric,
  p_sku text default null,
  p_model_number text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_status public.device_status;
begin
  if not public.has_permission('devices.edit_own_submissions') then
    raise exception 'Not authorized to edit submissions.' using errcode = '42501';
  end if;
  select d.created_by, d.status into v_owner, v_status from public.devices d where d.id = p_id for update;
  if v_owner is null or v_owner <> (select auth.uid()) then
    raise exception 'Submission not found.' using errcode = 'P0002';
  end if;
  if v_status not in ('pending_review', 'rejected', 'draft') then
    raise exception 'Only submissions awaiting review can be edited.';
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
  if not exists (select 1 from public.brands b where b.id = p_brand_id and b.is_active) then
    raise exception 'Selected brand does not exist or is inactive.';
  end if;
  if p_category_id is not null and not exists (select 1 from public.categories c where c.id = p_category_id and c.is_active) then
    raise exception 'Selected category does not exist or is inactive.';
  end if;

  update public.devices
  set name = btrim(p_name), brand_id = p_brand_id, category_id = p_category_id,
      sku = nullif(btrim(p_sku), ''), model_number = nullif(btrim(p_model_number), ''),
      metadata = p_metadata, status = 'pending_review', updated_by = (select auth.uid())
  where id = p_id;

  update public.device_financials
  set official_purchase_price = p_official_purchase_price, updated_by = (select auth.uid())
  where device_id = p_id;
end;
$$;

-- Atomic create/update of a device and its pricing (Administrator / Pricing
-- Manager). Delegates to the baseline RPCs so their permission checks and
-- validation apply unchanged, all inside one transaction.
create or replace function public.save_device(
  p_device_id  uuid,
  p_device     jsonb,
  p_financials jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id       uuid := p_device_id;
  v_status   public.device_status := nullif(p_device ->> 'status', '')::public.device_status;
  v_expected timestamptz := nullif(p_device ->> 'expected_updated_at', '')::timestamptz;
  v_current  timestamptz;
  v_old      public.device_status;
  v_category uuid := nullif(p_device ->> 'category_id', '')::uuid;
begin
  if v_id is null then
    v_id := public.create_managed_device(
      p_device ->> 'name',
      (p_device ->> 'brand_id')::uuid,
      v_category,
      (p_financials ->> 'official_purchase_price')::numeric,
      coalesce(nullif(p_financials ->> 'discount_type', ''), 'percentage')::public.discount_type,
      coalesce(nullif(p_financials ->> 'discount_value', '')::numeric, 0),
      coalesce(nullif(p_financials ->> 'payback_amount', '')::numeric, 0),
      coalesce(nullif(p_financials ->> 'company_profit', '')::numeric, 0),
      p_device ->> 'sku',
      p_device ->> 'model_number',
      coalesce(p_device -> 'metadata', '{}'::jsonb),
      coalesce(v_status, 'draft')
    );
    return v_id;
  end if;

  select d.updated_at, d.status into v_current, v_old from public.devices d where d.id = v_id for update;
  if not found then
    raise exception 'Device was not found.' using errcode = 'P0002';
  end if;
  if v_expected is not null and date_trunc('milliseconds', v_current) <> date_trunc('milliseconds', v_expected) then
    raise exception 'This device was modified by someone else. Reload to see the latest version.'
      using errcode = '40001';
  end if;

  perform public.update_device_details(
    v_id, p_device ->> 'name', (p_device ->> 'brand_id')::uuid, v_category,
    p_device ->> 'sku', p_device ->> 'model_number', coalesce(p_device -> 'metadata', '{}'::jsonb));

  if p_financials is not null then
    perform public.update_device_financials(
      v_id,
      (p_financials ->> 'official_purchase_price')::numeric,
      coalesce(nullif(p_financials ->> 'discount_type', ''), 'percentage')::public.discount_type,
      coalesce(nullif(p_financials ->> 'discount_value', '')::numeric, 0),
      coalesce(nullif(p_financials ->> 'payback_amount', '')::numeric, 0),
      coalesce(nullif(p_financials ->> 'company_profit', '')::numeric, 0));
  end if;

  if v_status is not null and v_status is distinct from v_old then
    perform public.set_device_status(v_id, v_status);
  end if;
  return v_id;
end;
$$;

-- Bulk status change; every row goes through the baseline set_device_status().
create or replace function public.set_devices_status(p_ids uuid[], p_status public.device_status)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 1000 then
    raise exception 'At most 1000 devices can be changed at once.' using errcode = '22023';
  end if;
  foreach v_id in array p_ids loop
    if exists (select 1 from public.devices d where d.id = v_id and d.status is distinct from p_status) then
      perform public.set_device_status(v_id, p_status);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Everything the app needs about the signed-in user in one round trip.
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'role', p.role,
    'is_active', p.is_active,
    'theme_preference', p.theme_preference,
    'locale', p.locale,
    'permissions', case
      when not p.is_active then '[]'::jsonb
      when p.role = 'administrator' then coalesce((
        select jsonb_agg(pc.permission_key order by pc.permission_key) from public.permission_catalog pc), '[]'::jsonb)
      else coalesce((
        select jsonb_agg(rp.permission_key order by rp.permission_key)
        from public.role_permissions rp where rp.role = p.role and rp.allowed), '[]'::jsonb)
    end,
    'settings', (
      select jsonb_build_object(
        'company_name', s.company_name, 'company_tagline', s.company_tagline,
        'company_logo_url', s.company_logo_url, 'currency_code', s.currency_code,
        'currency_decimal_places', s.currency_decimal_places, 'timezone_name', s.timezone_name,
        'default_locale', s.default_locale, 'report_footer', s.report_footer,
        'idle_timeout_minutes', s.idle_timeout_minutes)
      from public.company_settings s where s.id
    )
  )
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Permissions of another role, for the "View As" preview.
create or replace function public.role_permission_keys(p_role public.app_role)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('roles.preview') then
    raise exception 'Not authorized to preview roles.' using errcode = '42501';
  end if;
  return coalesce((
    select array_agg(rp.permission_key order by rp.permission_key)
    from public.role_permissions rp
    where rp.role = p_role and rp.allowed
  ), '{}');
end;
$$;

-- Permission matrix with lock state, for the Roles & Permissions screen.
create or replace function public.permission_matrix()
returns table (role public.app_role, permission_key text, description text, permission_group text,
               allowed boolean, locked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('roles.manage') then
    raise exception 'Not authorized to view role permissions.' using errcode = '42501';
  end if;
  return query
    select r.role, pc.permission_key, pc.description, pc.permission_group,
           case when r.role = 'administrator' then true else coalesce(rp.allowed, false) end,
           private.locked_permission_value(r.role, pc.permission_key) is not null
    from unnest(enum_range(null::public.app_role)) as r(role)
    cross join public.permission_catalog pc
    left join public.role_permissions rp on rp.role = r.role and rp.permission_key = pc.permission_key
    order by pc.permission_group, pc.permission_key, r.role;
end;
$$;

create or replace function public.admin_set_role_permission(
  p_role public.app_role, p_key text, p_allowed boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('roles.manage') then
    raise exception 'Not authorized to change role permissions.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.permission_catalog where permission_key = p_key) then
    raise exception 'Unknown permission.' using errcode = 'P0002';
  end if;
  -- The guard trigger rejects locked cells.
  insert into public.role_permissions (role, permission_key, allowed)
  values (p_role, p_key, p_allowed)
  on conflict (role, permission_key) do update set allowed = excluded.allowed;
end;
$$;

-- Audit entry for an invitation sent through the Auth Admin API.
create or replace function public.admin_log_user_invited(
  p_user_id uuid, p_email text, p_role public.app_role, p_resent boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'administrator'::public.app_role then
    raise exception 'Only an Administrator can invite users.' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  values ((select auth.uid()), case when p_resent then 'USER_INVITE_RESENT' else 'USER_INVITED' end,
          'profiles', p_user_id, null, jsonb_build_object('email', lower(p_email), 'role', p_role));
end;
$$;

create or replace function public.update_my_preferences(p_theme text default null, p_locale text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_active_user() then
    raise exception 'An active authenticated account is required.' using errcode = '42501';
  end if;
  update public.profiles
  set theme_preference = coalesce(p_theme, theme_preference),
      locale = coalesce(p_locale, locale)
  where id = (select auth.uid());
end;
$$;

create or replace function public.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r jsonb := '{}'::jsonb;
begin
  if not public.is_active_user() then
    raise exception 'An active account is required.' using errcode = '42501';
  end if;

  r := r || jsonb_build_object(
    'brands', (select count(*) from public.brands where is_active),
    'categories', (select count(*) from public.categories where is_active));

  if private.can_read_catalog() then
    r := r || jsonb_build_object(
      'catalog_devices', (select count(*) from public.devices d
        join public.device_public_pricing pp on pp.device_id = d.id
        join public.brands b on b.id = d.brand_id and b.is_active
        where d.status = 'active'),
      'catalog_added_30d', (select count(*) from public.devices d
        join public.device_public_pricing pp on pp.device_id = d.id
        where d.status = 'active' and d.created_at >= now() - interval '30 days'));
  end if;

  if public.has_permission('devices.read_all') then
    r := r || jsonb_build_object(
      'devices_by_status', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
        from (select status, count(*) n from public.devices group by status) s),
      'devices_total', (select count(*) from public.devices where status <> 'archived'));
  end if;

  if private.can_read_full() then
    r := r || jsonb_build_object('financials', (
      select jsonb_build_object(
        'active_devices', count(*),
        'total_purchase', coalesce(sum(f.official_purchase_price), 0),
        'total_discount', coalesce(sum(f.discount_amount), 0),
        'total_payback', coalesce(sum(f.payback_amount), 0),
        'total_cost', coalesce(sum(f.final_cost_before_profit), 0),
        'total_profit', coalesce(sum(f.company_profit), 0),
        'total_selling', coalesce(sum(f.final_selling_price), 0),
        'avg_profit', round(avg(f.company_profit), 2),
        'avg_margin_pct', case when sum(f.final_selling_price) > 0
          then round(sum(f.company_profit) * 100 / sum(f.final_selling_price), 2) end)
      from public.devices d join public.device_financials f on f.device_id = d.id
      where d.status = 'active'));
  end if;

  if public.has_permission('users.manage') then
    r := r || jsonb_build_object(
      'users_total', (select count(*) from public.profiles),
      'users_active', (select count(*) from public.profiles where is_active),
      'users_by_role', (select coalesce(jsonb_object_agg(s.role, s.n), '{}'::jsonb)
        from (select role, count(*) n from public.profiles where is_active group by role) s),
      'invitations_pending', (select count(*) from public.profiles where email_confirmed_at is null and is_active));
  end if;

  if public.has_permission('devices.submit') then
    r := r || jsonb_build_object('my_submissions', (
      select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
      from (select status, count(*) n from public.devices where created_by = v_uid group by status) s));
  end if;

  return r;
end;
$$;

create or replace function public.brand_overview(p_include_inactive boolean default false)
returns table (
  id uuid, name text, description text, logo_url text, accent_color text,
  is_active boolean, sort_order integer, created_at timestamptz,
  catalog_count bigint, total_count bigint, pending_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean := public.has_permission('devices.read_all');
begin
  if not public.has_permission('brands.read') then
    raise exception 'Not authorized to read brands.' using errcode = '42501';
  end if;
  return query
    select b.id, b.name, b.description, b.logo_url, b.accent_color, b.is_active, b.sort_order, b.created_at,
      (select count(*) from public.devices d join public.device_public_pricing pp on pp.device_id = d.id
        where d.brand_id = b.id and d.status = 'active'),
      case when v_all then (select count(*) from public.devices d where d.brand_id = b.id and d.status <> 'archived') end,
      case when v_all then (select count(*) from public.devices d where d.brand_id = b.id and d.status = 'pending_review') end
    from public.brands b
    where b.is_active or (p_include_inactive and (v_all or public.has_permission('brands.manage')))
    order by b.sort_order, lower(b.name);
end;
$$;

-- Single catalogue record for the Viewer detail page.
create or replace function public.get_catalog_device(p_id uuid)
returns table (
  id uuid, name text, brand_id uuid, brand_name text, brand_color text,
  category_id uuid, category_name text, final_selling_price numeric,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_catalog() then
    raise exception 'Not authorized to read the device catalogue.' using errcode = '42501';
  end if;
  return query
    select d.id, d.name, d.brand_id, b.name, b.accent_color, d.category_id, c.name,
           pp.final_selling_price, d.created_at, d.updated_at
    from public.devices d
    join public.brands b on b.id = d.brand_id and b.is_active
    left join public.categories c on c.id = d.category_id
    join public.device_public_pricing pp on pp.device_id = d.id
    where d.id = p_id and d.status = 'active';
end;
$$;

-- Full record + history for the manager detail page.
create or replace function public.get_managed_device(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not private.can_read_full() then
    raise exception 'Not authorized to read private device financials.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'device', to_jsonb(d),
    'brand', jsonb_build_object('id', b.id, 'name', b.name, 'accent_color', b.accent_color, 'is_active', b.is_active),
    'category', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end,
    'financials', to_jsonb(f),
    'created_by_name', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = d.created_by),
    'updated_by_name', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = d.updated_by),
    'history', case when public.has_permission('audit.read') then (
      select coalesce(jsonb_agg(h order by h.created_at desc), '[]'::jsonb) from (
        select a.id, a.action, a.table_name, a.created_at, a.old_data, a.new_data,
               (select coalesce(p.full_name, p.email) from public.profiles p where p.id = a.actor_id) actor
        from public.audit_logs a
        where a.record_id = d.id and a.table_name in ('devices', 'device_financials')
        order by a.created_at desc limit 40) h)
    else null end
  ) into v
  from public.devices d
  join public.brands b on b.id = d.brand_id
  left join public.categories c on c.id = d.category_id
  left join public.device_financials f on f.device_id = d.id
  where d.id = p_id;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE privileges: signed-in users only; each function checks permissions.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.search_devices(jsonb, text, jsonb, integer)',
    'public.device_summary(jsonb)',
    'public.search_catalog(jsonb, text, jsonb, integer)',
    'public.catalog_summary(jsonb)',
    'public.my_submissions(text, public.device_status, integer, integer)',
    'public.update_my_submission(uuid, text, uuid, uuid, numeric, text, text, jsonb)',
    'public.save_device(uuid, jsonb, jsonb)',
    'public.set_devices_status(uuid[], public.device_status)',
    'public.my_context()',
    'public.role_permission_keys(public.app_role)',
    'public.permission_matrix()',
    'public.admin_set_role_permission(public.app_role, text, boolean)',
    'public.admin_log_user_invited(uuid, text, public.app_role, boolean)',
    'public.update_my_preferences(text, text)',
    'public.dashboard_summary()',
    'public.brand_overview(boolean)',
    'public.get_catalog_device(uuid)',
    'public.get_managed_device(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
