-- ===========================================================================
-- Al-Esnad Pricing — selling-price sync to alisnad.iq and ERPNext
-- Additive and idempotent. Run after 20261120120000_device_delete.sql.
--
--   * devices.erp_item_code — the ERPNext item code. alisnad.iq products carry
--     the same code (products.erp_item_code), so it links one device across the
--     three systems.
--   * price_sync_jobs — an outbox. A trigger records a job whenever a linked,
--     ACTIVE device gets a new selling price, is approved, or is linked. The app
--     server pushes each job's price to alisnad.iq (products.base_price) and
--     ERPNext (Item Price) and stores the outcome; failed jobs are retried.
--     Only the newest job per device matters: older open ones are superseded.
-- ===========================================================================

-- 1. Join key --------------------------------------------------------------------
alter table public.devices add column if not exists erp_item_code text;

do $$ begin
  alter table public.devices add constraint devices_erp_item_code_clean
    check (erp_item_code is null or (erp_item_code = btrim(erp_item_code) and length(erp_item_code) between 1 and 140));
exception when duplicate_object then null; end $$;

create unique index if not exists devices_erp_item_code_uidx
  on public.devices (erp_item_code) where erp_item_code is not null;

-- 2. Outbox ----------------------------------------------------------------------
create table if not exists public.price_sync_jobs (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  erp_item_code text not null,
  selling_price numeric(18,2) not null,
  currency_code char(3) not null,
  reason text not null check (reason in ('price_changed', 'activated', 'linked', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'superseded')),
  attempts integer not null default 0,
  -- Per target: {"alisnad": {"status": "updated", "old": 370000, "new": 371000, ...}, "erpnext": {...}}
  results jsonb not null default '{}'::jsonb,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists price_sync_jobs_device_idx on public.price_sync_jobs (device_id, id desc);
create index if not exists price_sync_jobs_open_idx on public.price_sync_jobs (id)
  where status in ('pending', 'processing', 'failed');

drop trigger if exists price_sync_jobs_set_updated_at on public.price_sync_jobs;
create trigger price_sync_jobs_set_updated_at before update on public.price_sync_jobs
for each row execute function public.set_updated_at();

-- Pricing staff may read the log; nobody writes it directly. The enqueue trigger
-- and request_price_sync() are SECURITY DEFINER, the worker uses the service role.
alter table public.price_sync_jobs enable row level security;
revoke all on public.price_sync_jobs from public, anon, authenticated;
grant select on public.price_sync_jobs to authenticated;
grant select, insert, update, delete on public.price_sync_jobs to service_role;

drop policy if exists price_sync_jobs_read on public.price_sync_jobs;
create policy price_sync_jobs_read on public.price_sync_jobs
for select to authenticated
using ((select public.has_permission('financials.read')));

-- 3. Enqueue ---------------------------------------------------------------------
create or replace function private.enqueue_price_sync(p_device_id uuid, p_reason text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_status public.device_status;
  v_price numeric(18,2);
  v_currency char(3);
  v_id bigint;
begin
  select d.erp_item_code, d.status, f.final_selling_price
    into v_code, v_status, v_price
  from public.devices d
  left join public.device_financials f on f.device_id = d.id
  where d.id = p_device_id;

  if v_code is null or v_status is distinct from 'active'::public.device_status or v_price is null then
    return null;
  end if;

  select s.currency_code into v_currency from public.company_settings s where s.id;

  update public.price_sync_jobs
     set status = 'superseded'
   where device_id = p_device_id and status in ('pending', 'failed');

  insert into public.price_sync_jobs (device_id, erp_item_code, selling_price, currency_code, reason, created_by)
  values (p_device_id, v_code, v_price, coalesce(v_currency, 'IQD'), p_reason, (select auth.uid()))
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
  else
    if new.erp_item_code is distinct from old.erp_item_code then
      perform private.enqueue_price_sync(new.id, 'linked');
    elsif new.status is distinct from old.status and new.status = 'active'::public.device_status then
      perform private.enqueue_price_sync(new.id, 'activated');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enqueue_price_sync(uuid, text) from public, anon, authenticated;
revoke all on function private.price_sync_trigger() from public, anon, authenticated;

-- Not "update of final_selling_price": that column is computed by a BEFORE trigger,
-- never named in the UPDATE itself, so a column trigger would not fire. The
-- function compares old and new instead.
drop trigger if exists price_sync_after_financials on public.device_financials;
create trigger price_sync_after_financials
after insert or update on public.device_financials
for each row execute function private.price_sync_trigger();

drop trigger if exists price_sync_after_device on public.devices;
create trigger price_sync_after_device
after update of status, erp_item_code on public.devices
for each row execute function private.price_sync_trigger();

-- 4. "Sync now" from the app --------------------------------------------------------
create or replace function public.request_price_sync(p_device_id uuid)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.has_permission('financials.update') then
    raise exception 'Not authorized to sync prices.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.devices d where d.id = p_device_id) then
    raise exception 'Device was not found.' using errcode = 'P0002';
  end if;
  v_id := private.enqueue_price_sync(p_device_id, 'manual');
  if v_id is null then
    raise exception 'Only active devices with an ERPNext item code and a selling price can be synced.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

revoke all on function public.request_price_sync(uuid) from public, anon;
grant execute on function public.request_price_sync(uuid) to authenticated;

-- 5. save_device(): also stores the ERPNext item code ----------------------------------
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
  v_erp      text := nullif(btrim(p_device ->> 'erp_item_code'), '');
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

  -- The permission checks ran in the functions above; only then is the link written.
  if p_device ? 'erp_item_code' then
    update public.devices d
       set erp_item_code = v_erp
     where d.id = v_id
       and d.erp_item_code is distinct from v_erp;
  end if;
  return v_id;
end;
$$;
