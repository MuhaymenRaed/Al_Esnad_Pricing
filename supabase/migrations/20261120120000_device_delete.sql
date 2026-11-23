-- ===========================================================================
-- Al-Esnad Pricing — permanent device deletion
-- Additive and idempotent. Run after 20261117090000_app_extensions.sql.
--
--   * New permission `devices.delete`. Administrators always hold it; it can be
--     granted to Pricing Managers on the Roles & permissions screen (off by
--     default) and is locked off for Viewers and Data Entry operators.
--   * public.delete_devices(uuid[]) removes devices for good. Their financials
--     and catalogue price go with them (ON DELETE CASCADE). The baseline audit
--     triggers record every deleted row, so the audit log keeps what was lost.
-- ===========================================================================

insert into public.permission_catalog (permission_key, description, permission_group)
values ('devices.delete', 'Permanently delete device records and their pricing.', 'devices')
on conflict (permission_key) do update
set description = excluded.description,
    permission_group = excluded.permission_group;

-- Same matrix locks as app_extensions.sql, plus `devices.delete` for the
-- roles that must never be able to remove records.
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

-- Repair any existing cell that violates the separation (no-op normally).
delete from public.role_permissions rp
where private.locked_permission_value(rp.role, rp.permission_key) = false and rp.allowed;

create or replace function public.delete_devices(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.has_permission('devices.delete') then
    raise exception 'Not authorized to delete devices.' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 1000 then
    raise exception 'At most 1000 devices can be deleted at once.' using errcode = '22023';
  end if;

  delete from public.devices d where d.id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.delete_devices(uuid[]) from public, anon;
grant execute on function public.delete_devices(uuid[]) to authenticated;
