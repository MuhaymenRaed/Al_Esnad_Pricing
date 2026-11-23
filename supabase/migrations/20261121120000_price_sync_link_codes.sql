-- ===========================================================================
-- Al-Esnad Pricing — price sync: several link codes per device
-- Additive and idempotent. Run after 20261121090000_price_sync.sql.
--
-- ERPNext keeps one Item per colour ("TECNO SPARK 50S 5G KN8S 256+8 INK BLACK",
-- "… TITANIUM GREY", …) while alisnad.iq keeps one product per storage option
-- with its own code (products.erp_item_code, e.g. "ERPN-A6453C287A"). One device
-- in this app (one storage option, one selling price) therefore links to several
-- codes. Each code is looked up in BOTH systems and every match gets the price:
--   * alisnad.iq — products whose erp_item_code is one of the codes
--   * ERPNext    — Items whose item_code is one of the codes
-- A code belongs to at most one device.
-- ===========================================================================

-- 1. Link codes ------------------------------------------------------------------
create table if not exists public.device_link_codes (
  code text primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint device_link_codes_clean check (code = btrim(code) and length(code) between 1 and 140)
);
create index if not exists device_link_codes_device_idx on public.device_link_codes (device_id);

alter table public.device_link_codes enable row level security;
revoke all on public.device_link_codes from public, anon, authenticated;
grant select on public.device_link_codes to authenticated;
grant select, insert, update, delete on public.device_link_codes to service_role;
drop policy if exists device_link_codes_read on public.device_link_codes;
create policy device_link_codes_read on public.device_link_codes
for select to authenticated
using ((select public.has_permission('financials.read')));

drop trigger if exists device_link_codes_audit on public.device_link_codes;
create trigger device_link_codes_audit after insert or update or delete on public.device_link_codes
for each row execute function public.write_audit_log();

-- 2. Carry single codes over, then retire devices.erp_item_code ---------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'devices' and column_name = 'erp_item_code') then
    insert into public.device_link_codes (code, device_id)
    select d.erp_item_code, d.id from public.devices d where d.erp_item_code is not null
    on conflict (code) do nothing;
  end if;
end $$;

drop trigger if exists price_sync_after_device on public.devices;
drop index if exists public.devices_erp_item_code_uidx;
alter table public.devices drop constraint if exists devices_erp_item_code_clean;
alter table public.devices drop column if exists erp_item_code;

-- 3. Jobs carry the codes they were sent to --------------------------------------
alter table public.price_sync_jobs add column if not exists codes text[] not null default '{}';
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'price_sync_jobs' and column_name = 'erp_item_code') then
    execute 'update public.price_sync_jobs set codes = array[erp_item_code] where codes = ''{}'' and erp_item_code is not null';
  end if;
end $$;
alter table public.price_sync_jobs drop column if exists erp_item_code;

-- 4. Enqueue: needs at least one link code ---------------------------------------
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
  v_currency char(3);
  v_id bigint;
begin
  select d.status, f.final_selling_price
    into v_status, v_price
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

  insert into public.price_sync_jobs (device_id, codes, selling_price, currency_code, reason, created_by)
  values (p_device_id, v_codes, v_price, coalesce(v_currency, 'IQD'), p_reason, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.price_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'device_financials' then
    if tg_op = 'UPDATE' and new.final_selling_price is not distinct from old.final_selling_price then
      return new;
    end if;
    perform private.enqueue_price_sync(new.device_id, 'price_changed');
  elsif new.status is distinct from old.status and new.status = 'active'::public.device_status then
    perform private.enqueue_price_sync(new.id, 'activated');
  end if;
  return new;
end;
$$;

drop trigger if exists price_sync_after_device on public.devices;
create trigger price_sync_after_device
after update of status on public.devices
for each row execute function private.price_sync_trigger();

-- 5. Replace a device's link codes (called by save_device after its permission checks)
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

  perform private.enqueue_price_sync(p_device_id, 'linked');
end;
$$;

revoke all on function private.set_device_link_codes(uuid, jsonb) from public, anon, authenticated;

-- 6. save_device(): link codes instead of a single item code ---------------------------
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
  else
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
  end if;

  -- The permission checks ran in the functions above; only then are links written.
  if p_device ? 'link_codes' then
    perform private.set_device_link_codes(v_id, p_device -> 'link_codes');
  end if;
  return v_id;
end;
$$;

-- 7. get_managed_device(): also returns the link codes ----------------------------------
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
    'link_codes', (select coalesce(jsonb_agg(l.code order by l.code), '[]'::jsonb) from public.device_link_codes l where l.device_id = d.id),
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
