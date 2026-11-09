-- What Avelon pays each tutor per hour. Admin only: tutors, parents and students can't read it.
create table if not exists public.tutor_pay (
  tutor_id uuid primary key references public.profiles(id) on delete cascade,
  rate_cents integer check (rate_cents is null or (rate_cents >= 0 and rate_cents <= 100000)),
  updated_at timestamptz not null default now()
);
alter table public.tutor_pay enable row level security;
create policy tutor_pay_admin on public.tutor_pay for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
grant select, insert, update, delete on public.tutor_pay to authenticated;
grant select, insert, update, delete on public.tutor_pay to service_role;

-- Admin edits a parent's or tutor's name and phone (email is their login, so it stays).
create or replace function public.admin_set_profile(p_user uuid, p_name text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Admins only'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please enter a name.'; end if;
  update public.profiles set full_name = left(trim(p_name), 100), phone = nullif(left(regexp_replace(trim(coalesce(p_phone, '')), '\s+', ' ', 'g'), 30), '')
   where id = p_user;
  if not found then raise exception 'Person not found.'; end if;
end; $$;
revoke all on function public.admin_set_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_set_profile(uuid, text, text) to authenticated;
