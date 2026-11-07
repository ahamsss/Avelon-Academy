-- =====================================================================
-- Avelon Academy portal: database
-- Applied by `npx supabase db push` (see backend/README.md),
-- or paste into Supabase > SQL Editor > New query > Run. Run once on a new project.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------------------------------------------------

-- One row per login (parents, tutors, you). Created automatically on sign-up.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role text not null default 'parent' check (role in ('parent','tutor','admin')),
  stripe_customer_id text,
  default_payment_method text,
  card_brand text,
  card_last4 text,
  created_at timestamptz not null default now()
);

-- Children. Added by the parent; tutor + rate are set by the admin.
create table public.students (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null,
  grade text,
  subject text,
  student_email text,
  tutor_id uuid references public.profiles(id),
  rate_cents integer check (rate_cents >= 0),          -- price per hour, in cents
  trial_status text not null default 'trial'
    check (trial_status in ('trial','continuing','ended')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Weekly card charges.
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles(id),
  amount_cents integer not null,
  status text not null default 'processing'
    check (status in ('processing','succeeded','failed')),
  stripe_payment_intent text,
  failure_message text,
  created_at timestamptz not null default now()
);

-- One row per class taught.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid not null references public.profiles(id),
  class_date date not null,
  minutes integer not null check (minutes between 15 and 240),
  notes text,
  homework text,
  trial_number integer,                                   -- 1, 2 or 3 during the trial
  amount_cents integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending','approved','flagged','void')),
  approved_by text,                                       -- family, auto, admin
  approved_at timestamptz,
  flag_reason text,
  approve_token uuid not null default gen_random_uuid(),
  charge_id uuid references public.charges(id),
  created_at timestamptz not null default now()
);

create index on public.students (parent_id);
create index on public.students (tutor_id);
create index on public.sessions (student_id);
create index on public.sessions (tutor_id);
create index on public.sessions (status);
create unique index on public.sessions (approve_token);

-- ---------- New sign-ups get a profile --------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Who is calling? (used by the security rules below)
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- Security: row level security ------------------------------

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.sessions enable row level security;
alter table public.charges  enable row level security;

-- Nobody who is logged out can touch anything.
revoke all on public.profiles, public.students, public.sessions, public.charges from anon;

-- Logged-in users: reads are filtered by the policies; writes are limited to a few columns.
revoke insert, update, delete on public.profiles, public.students, public.sessions, public.charges from authenticated;
grant select on public.profiles, public.students, public.sessions, public.charges to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant insert (parent_id, first_name, grade, subject, student_email) on public.students to authenticated;
grant update (first_name, grade, subject, student_email) on public.students to authenticated;

-- profiles: you see yourself; admin sees everyone. Tutors never see parents.
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.my_role() = 'admin');
create policy profiles_edit on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- students: parent sees own children; admin sees all. (Tutors use tutor_students() below.)
create policy students_read on public.students for select
  using (parent_id = auth.uid() or public.my_role() = 'admin');
create policy students_add on public.students for insert
  with check (parent_id = auth.uid());
create policy students_edit on public.students for update
  using (parent_id = auth.uid()) with check (parent_id = auth.uid());

-- sessions: tutor sees classes they taught; parent sees their children's; admin sees all.
create policy sessions_read on public.sessions for select
  using (
    tutor_id = auth.uid()
    or public.my_role() = 'admin'
    or exists (select 1 from public.students s
               where s.id = sessions.student_id and s.parent_id = auth.uid())
  );

-- charges: parent sees own; admin sees all.
create policy charges_read on public.charges for select
  using (parent_id = auth.uid() or public.my_role() = 'admin');

-- ---------- Actions (each one checks who is allowed) ------------------

-- Tutor: list my students (first name, grade, subject only; no family contact details).
create or replace function public.tutor_students()
returns table (id uuid, first_name text, grade text, subject text, trial_status text)
language sql stable security definer set search_path = public as $$
  select s.id, s.first_name, s.grade, s.subject, s.trial_status
  from public.students s
  where s.tutor_id = auth.uid() and s.active
  order by s.first_name
$$;

-- Parent: approve or flag a pending class from the portal.
create or replace function public.review_session(p_session uuid, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_action not in ('approve','flag') then raise exception 'Unknown action'; end if;
  update public.sessions se
     set status = case when p_action = 'approve' then 'approved' else 'flagged' end,
         approved_by = case when p_action = 'approve' then 'family' else null end,
         approved_at = case when p_action = 'approve' then now() else null end,
         flag_reason = case when p_action = 'flag' then left(coalesce(p_reason,''), 500) else null end
   where se.id = p_session
     and se.status = 'pending'
     and exists (select 1 from public.students s where s.id = se.student_id and s.parent_id = auth.uid());
  if not found then raise exception 'This class can no longer be changed.'; end if;
end; $$;

-- Parent: after the trial, continue (needs a card) or stop (trial classes stay free).
create or replace function public.parent_trial_decision(p_student uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare v_card text;
begin
  if p_decision not in ('continuing','ended') then raise exception 'Unknown choice'; end if;
  if not exists (select 1 from public.students where id = p_student and parent_id = auth.uid() and trial_status = 'trial') then
    raise exception 'This trial has already been decided.';
  end if;
  if p_decision = 'continuing' then
    select default_payment_method into v_card from public.profiles where id = auth.uid();
    if v_card is null then raise exception 'Please add a card first.'; end if;
    update public.students set trial_status = 'continuing' where id = p_student;
  else
    update public.students set trial_status = 'ended', active = false where id = p_student;
    update public.sessions set status = 'void', amount_cents = 0
     where student_id = p_student and trial_number in (2,3) and charge_id is null;
  end if;
end; $$;

-- Admin: assign tutor, set hourly rate, trial status, active.
create or replace function public.admin_update_student(
  p_student uuid, p_tutor uuid, p_rate_cents integer, p_trial_status text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Admins only'; end if;
  if p_tutor is not null and not exists (select 1 from public.profiles where id = p_tutor and role = 'tutor') then
    raise exception 'That person is not a tutor.';
  end if;
  update public.students
     set tutor_id = p_tutor, rate_cents = p_rate_cents,
         trial_status = coalesce(p_trial_status, trial_status), active = coalesce(p_active, active)
   where id = p_student;
end; $$;

-- Admin: settle a flagged class (approve it, or void it so it is never charged).
create or replace function public.admin_set_session(p_session uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Admins only'; end if;
  if p_status not in ('approved','void') then raise exception 'Unknown status'; end if;
  update public.sessions
     set status = p_status,
         approved_by = case when p_status = 'approved' then 'admin' else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end
   where id = p_session and charge_id is null;
  if not found then raise exception 'Already charged, or not found.'; end if;
end; $$;

-- Admin: make someone a tutor, parent or admin.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Admins only'; end if;
  if p_role not in ('parent','tutor','admin') then raise exception 'Unknown role'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own admin access.'; end if;
  update public.profiles set role = p_role where id = p_user;
end; $$;

-- Only logged-in users may call these; each checks the role itself.
revoke execute on function public.tutor_students(), public.review_session(uuid,text,text),
  public.parent_trial_decision(uuid,text), public.admin_update_student(uuid,uuid,integer,text,boolean),
  public.admin_set_session(uuid,text), public.admin_set_role(uuid,text) from public, anon;
grant execute on function public.tutor_students(), public.review_session(uuid,text,text),
  public.parent_trial_decision(uuid,text), public.admin_update_student(uuid,uuid,integer,text,boolean),
  public.admin_set_session(uuid,text), public.admin_set_role(uuid,text) to authenticated;

-- ---------- Backend access ---------------------------------------------
-- The edge functions use the service_role key. Grant it explicitly so the
-- backend works even when "Automatically expose new tables" is turned off.
grant usage on schema public to service_role;
grant all on public.profiles, public.students, public.sessions, public.charges to service_role;
grant execute on all functions in schema public to service_role;

-- RLS policies call my_role(); only logged-in users (and the backend) may execute it.
revoke execute on function public.my_role(), public.handle_new_user() from public, anon, authenticated;
grant execute on function public.my_role() to authenticated;
