-- ===========================================================================
-- Al-Esnad Pricing — publish prices on request, with a status per system
-- Additive and idempotent. Run after 20261121120000_price_sync_link_codes.sql.
--
--   * Nothing is pushed automatically any more. Changing a price, approving a
--     device or linking it only changes this app. alisnad.iq and ERPNext change
--     when pricing staff press "Publish" on a device or on a selection of devices.
--   * ERPNext also receives the purchase price (its buying price list);
--     alisnad.iq only receives the final selling price.
--   * device_sync_state keeps what each system held for a device's link codes at
--     the last check or publish (names, active flags, prices). Device lists show
--     from it, per system, whether the device is there and whether its prices
--     match this app. The app server writes it (service role).
--   * New permission `prices.publish`: Administrators always; can be granted to
--     Pricing Managers (off by default); locked off for Viewers and Data Entry.
--   * import_erp_devices(): creates devices from ERPNext Items (pending review,
--     purchase price from ERPNext, linked to the item code).
-- ===========================================================================

-- 0. Permission -----------------------------------------------------------------------
insert into public.permission_catalog (permission_key, description, permission_group)
values ('prices.publish', 'Publish selling and purchase prices to alisnad.iq and ERPNext.', 'financials')
on conflict (permission_key) do update
set description = excluded.description,
    permission_group = excluded.permission_group;

create or replace function private.locked_permission_value(p_role public.app_role, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role = 'administrator' then true
    when p_role in ('viewer', 'data_entry') and p_key in (
      'devices.read_all', 'devices.create', 'devices.update', 'devices.archive', 'devices.delete',
      'financials.read', 'financials.update', 'prices.publish', 'submissions.review', 'roles.preview',
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

delete from public.role_permissions rp
where private.locked_permission_value(rp.role, rp.permission_key) = false and rp.allowed;

-- 1. No automatic sync ------------------------------------------------------------
drop trigger if exists price_sync_after_financials on public.device_financials;
drop trigger if exists price_sync_after_device on public.devices;
drop function if exists private.price_sync_trigger();

-- 2. Jobs also carry the purchase (buying) price ---------------------------------------
alter table public.price_sync_jobs add column if not exists buying_price numeric(18,2);

-- 3. What each system holds for a device ----------------------------------------------
create table if not exists public.device_sync_state (
  device_id uuid not null references public.devices(id) on delete cascade,
  target text not null check (target in ('alisnad', 'erpnext')),
  -- The link codes this state describes; a different set means "not checked yet".
  codes text[] not null default '{}',
  -- Matched items: [{"code", "name", "active", "selling", "buying"}]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  error text,
  checked_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (device_id, target)
);

alter table public.device_sync_state enable row level security;
revoke all on public.device_sync_state from public, anon, authenticated;
grant select on public.device_sync_state to authenticated;
grant select, insert, update, delete on public.device_sync_state to service_role;

drop policy if exists device_sync_state_read on public.device_sync_state;
create policy device_sync_state_read on public.device_sync_state
for select to authenticated
using ((select public.has_permission('financials.read')));

-- 4. Enqueue: selling AND purchase price ---------------------------------------------
create or replace function private.enqueue_price_sync(p_device_id uuid, p_reason text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_codes text[];
  v_status public.device_status;
  v_price numeric(18,2);
  v_buying numeric(18,2);
  v_currency char(3);
  v_id bigint;
begin
  select d.status, f.final_selling_price, f.official_purchase_price
    into v_status, v_price, v_buying
  from public.devices d
  left join public.device_financials f on f.device_id = d.id
  where d.id = p_device_id;

  select array_agg(l.code order by l.code) into v_codes
  from public.device_link_codes l where l.device_id = p_device_id;

  if v_codes is null or v_status is distinct from 'active'::public.device_status or v_price is null then
    return null;
  end if;

  select s.currency_code into v_currency from public.company_settings s where s.id;

  update public.price_sync_jobs
     set status = 'superseded'
   where device_id = p_device_id and status in ('pending', 'failed');

  insert into public.price_sync_jobs (device_id, codes, selling_price, buying_price, currency_code, reason, created_by)
  values (p_device_id, v_codes, v_price, v_buying, coalesce(v_currency, 'IQD'), p_reason, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.enqueue_price_sync(uuid, text) from public, anon, authenticated;

-- 5. Changing link codes only forgets the old status (no automatic push) ---------------
create or replace function private.set_device_link_codes(p_device_id uuid, p_codes jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_new text[];
  v_old text[];
begin
  if jsonb_typeof(coalesce(p_codes, '[]'::jsonb)) <> 'array' then
    raise exception 'Link codes must be a list.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct btrim(c) order by btrim(c)), '{}')
    into v_new
  from jsonb_array_elements_text(coalesce(p_codes, '[]'::jsonb)) c
  where btrim(c) <> '';
  if cardinality(v_new) > 50 then
    raise exception 'A device can have at most 50 link codes.' using errcode = '22023';
  end if;

  select coalesce(array_agg(l.code order by l.code), '{}') into v_old
  from public.device_link_codes l where l.device_id = p_device_id;
  if v_new = v_old then
    return;
  end if;

  delete from public.device_link_codes l where l.device_id = p_device_id and not (l.code = any (v_new));
  -- A code already linked to ANOTHER device raises a unique violation (device_link_codes_pkey).
  insert into public.device_link_codes (code, device_id)
  select c, p_device_id from unnest(v_new) c
  where not exists (select 1 from public.device_link_codes l where l.code = c and l.device_id = p_device_id);

  delete from public.device_sync_state s where s.device_id = p_device_id;
end;
$$;

revoke all on function private.set_device_link_codes(uuid, jsonb) from public, anon, authenticated;

-- 6. "Publish" for one device or a selection ---------------------------------------------
drop function if exists public.request_price_sync(uuid);

-- One row per requested device: the job to process, or why it was skipped
-- (not_found, not_linked, not_active, no_price).
create or replace function public.request_price_syncs(p_ids uuid[])
returns table (device_id uuid, job_id bigint, skipped text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_status public.device_status;
  v_price numeric(18,2);
begin
  if not (public.has_permission('prices.publish') and public.has_permission('financials.update')) then
    raise exception 'Not authorized to publish prices.' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'At most 200 devices can be published at once.' using errcode = '22023';
  end if;

  for v_id in select distinct x from unnest(p_ids) x where x is not null loop
    device_id := v_id;
    job_id := null;
    skipped := null;
    select d.status, f.final_selling_price into v_status, v_price
    from public.devices d
    left join public.device_financials f on f.device_id = d.id
    where d.id = v_id;
    if not found then
      skipped := 'not_found';
    elsif not exists (select 1 from public.device_link_codes l where l.device_id = v_id) then
      skipped := 'not_linked';
    elsif v_status is distinct from 'active'::public.device_status then
      skipped := 'not_active';
    elsif v_price is null then
      skipped := 'no_price';
    else
      job_id := private.enqueue_price_sync(v_id, 'manual');
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.request_price_syncs(uuid[]) from public, anon;
grant execute on function public.request_price_syncs(uuid[]) to authenticated;

-- 7. Add link codes to many devices at once (automatic matching) ------------------------
-- p_links: [{"device_id": "…", "codes": ["…", …]}, …]. Codes are only ADDED; a code
-- owned by another device is reported in "taken" and skipped, never moved.
create or replace function public.link_devices(p_links jsonb)
returns table (device_id uuid, linked text[], taken text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_item jsonb;
  v_id uuid;
  v_code text;
  v_owner uuid;
begin
  if not (public.has_permission('devices.update') and public.has_permission('financials.update')) then
    raise exception 'Not authorized to link devices.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' then
    raise exception 'Links must be a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_links, '[]'::jsonb)) > 200 then
    raise exception 'At most 200 devices can be linked at once.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    v_id := nullif(v_item ->> 'device_id', '')::uuid;
    continue when v_id is null or not exists (select 1 from public.devices d where d.id = v_id);
    if jsonb_typeof(coalesce(v_item -> 'codes', '[]'::jsonb)) <> 'array' then
      raise exception 'Link codes must be a list.' using errcode = '22023';
    end if;
    device_id := v_id;
    linked := '{}';
    taken := '{}';
    for v_code in
      select distinct btrim(c) from jsonb_array_elements_text(coalesce(v_item -> 'codes', '[]'::jsonb)) c
      where btrim(c) <> '' and length(btrim(c)) <= 140
      limit 50
    loop
      select l.device_id into v_owner from public.device_link_codes l where l.code = v_code;
      if v_owner is null then
        if (select count(*) from public.device_link_codes l where l.device_id = v_id) >= 50 then
          exit;
        end if;
        insert into public.device_link_codes (code, device_id) values (v_code, v_id);
        linked := linked || v_code;
      elsif v_owner <> v_id then
        taken := taken || v_code;
      end if;
      v_owner := null;
    end loop;
    if cardinality(linked) > 0 then
      delete from public.device_sync_state s where s.device_id = v_id;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.link_devices(jsonb) from public, anon;
grant execute on function public.link_devices(jsonb) to authenticated;

-- 8. Devices from ERPNext ------------------------------------------------------------------
-- p_items: [{"code", "name", "brand_id", "category_id", "purchase", "update_price"}]
--   * a code already linked to a device: left alone ("exists"), or its purchase price is
--     replaced when update_price is true ("price_updated");
--   * a device with exactly this name and no link codes: linked to the code ("linked");
--   * otherwise a new device, pending review, with the purchase price and zero discount,
--     payback and profit; staff complete the rest and approve it ("created").
-- A purchase price of 0 or none means "not set": the device gets no price yet.
create or replace function public.import_erp_devices(p_items jsonb)
returns table (code text, device_id uuid, result text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_item jsonb;
  v_code text;
  v_name text;
  v_brand uuid;
  v_category uuid;
  v_price numeric(18,2);
  v_id uuid;
begin
  if not (public.has_permission('devices.create') and public.has_permission('financials.update')) then
    raise exception 'Not authorized to import devices.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Items must be a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then
    raise exception 'At most 500 items can be imported at once.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_code := btrim(coalesce(v_item ->> 'code', ''));
    v_name := btrim(coalesce(v_item ->> 'name', ''));
    v_price := nullif(nullif(v_item ->> 'purchase', ''), '0')::numeric;
    if v_code = '' or length(v_code) > 140 or v_name = '' then
      raise exception 'Each item needs a code and a name.' using errcode = '22023';
    end if;
    if v_price is not null and v_price < 0 then
      raise exception 'Purchase price cannot be negative.' using errcode = '22023';
    end if;
    code := v_code;
    v_id := null;

    select l.device_id into v_id from public.device_link_codes l where l.code = v_code;
    if v_id is not null then
      device_id := v_id;
      result := 'exists';
      if coalesce((v_item ->> 'update_price')::boolean, false) and v_price is not null then
        if exists (select 1 from public.device_financials f where f.device_id = v_id) then
          update public.device_financials f
             set official_purchase_price = v_price, updated_by = (select auth.uid())
           where f.device_id = v_id
             and f.official_purchase_price is distinct from v_price;
          if found then result := 'price_updated'; end if;
        else
          insert into public.device_financials (device_id, official_purchase_price, updated_by)
          values (v_id, v_price, (select auth.uid()));
          result := 'price_updated';
        end if;
      end if;
      return next;
      continue;
    end if;

    select d.id into v_id
    from public.devices d
    where lower(btrim(d.name)) = lower(v_name)
      and not exists (select 1 from public.device_link_codes l where l.device_id = d.id)
    order by d.created_at
    limit 1;
    if v_id is not null then
      insert into public.device_link_codes (code, device_id) values (v_code, v_id);
      delete from public.device_sync_state s where s.device_id = v_id;
      device_id := v_id;
      result := 'linked';
      return next;
      continue;
    end if;

    v_brand := nullif(v_item ->> 'brand_id', '')::uuid;
    v_category := nullif(v_item ->> 'category_id', '')::uuid;
    if not exists (select 1 from public.brands b where b.id = v_brand and b.is_active) then
      raise exception 'Brand does not exist or is inactive.' using errcode = '22023';
    end if;
    if v_category is not null and not exists (select 1 from public.categories c where c.id = v_category and c.is_active) then
      raise exception 'Category does not exist or is inactive.' using errcode = '22023';
    end if;

    insert into public.devices (name, brand_id, category_id, status, created_by, updated_by)
    values (v_name, v_brand, v_category, 'pending_review', (select auth.uid()), (select auth.uid()))
    returning id into v_id;
    if v_price is not null then
      insert into public.device_financials (device_id, official_purchase_price, updated_by)
      values (v_id, v_price, (select auth.uid()));
    end if;
    insert into public.device_link_codes (code, device_id) values (v_code, v_id);
    device_id := v_id;
    result := 'created';
    return next;
  end loop;
end;
$$;

revoke all on function public.import_erp_devices(jsonb) from public, anon;
grant execute on function public.import_erp_devices(jsonb) to authenticated;
