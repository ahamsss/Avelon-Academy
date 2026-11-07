-- Admin can fix anyone's display name.
create or replace function public.admin_set_name(p_user uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Admins only'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please enter a name.'; end if;
  update public.profiles set full_name = left(trim(p_name), 100) where id = p_user;
end; $$;
revoke execute on function public.admin_set_name(uuid, text) from public, anon;
grant execute on function public.admin_set_name(uuid, text) to authenticated;
