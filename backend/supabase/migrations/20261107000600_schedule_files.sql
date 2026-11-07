-- Class schedule (weekly slots with time + Google Meet link), class files, small-group preference,
-- student self-access (a teen whose email is on file can log in and see their own schedule and files),
-- and a storage usage report.

-- ---------- Small-group preference (parent ticks it per child) ----------
alter table public.students add column if not exists open_to_group boolean not null default false;
grant update (open_to_group) on public.students to authenticated;
grant insert (open_to_group) on public.students to authenticated;

-- ---------- Who can see / schedule a student ----------
create or replace function public.my_email()
returns text language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- Parent, assigned tutor, the student themself (by email) or admin.
create or replace function public.can_see_student(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student and (
      s.parent_id = auth.uid()
      or s.tutor_id = auth.uid()
      or (s.student_email is not null and lower(s.student_email) = public.my_email())
      or public.my_role() = 'admin'))
$$;

-- Assigned tutor or admin.
create or replace function public.can_schedule_student(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student and (s.tutor_id = auth.uid() or public.my_role() = 'admin'))
$$;

revoke execute on function public.my_email(), public.can_see_student(uuid), public.can_schedule_student(uuid) from public, anon;
grant execute on function public.my_email(), public.can_see_student(uuid), public.can_schedule_student(uuid) to authenticated;

-- A student with their own email can read their own record.
drop policy if exists students_read_self on public.students;
create policy students_read_self on public.students for select
  using (student_email is not null and lower(student_email) = public.my_email());

-- ---------- Weekly class slots ----------
create table if not exists public.class_slots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),          -- 0 = Sunday
  start_time time not null,
  minutes smallint not null default 60 check (minutes between 15 and 240),
  timezone text not null default 'America/Edmonton' check (char_length(timezone) <= 64),
  meet_link text check (meet_link is null or meet_link ~* '^https://[^[:space:]<>"]+$'),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists class_slots_student_idx on public.class_slots (student_id);
alter table public.class_slots enable row level security;
create policy class_slots_read on public.class_slots for select using (public.can_see_student(student_id));
create policy class_slots_add on public.class_slots for insert with check (public.can_schedule_student(student_id));
create policy class_slots_edit on public.class_slots for update
  using (public.can_schedule_student(student_id)) with check (public.can_schedule_student(student_id));
create policy class_slots_remove on public.class_slots for delete using (public.can_schedule_student(student_id));
grant select, insert, update, delete on public.class_slots to authenticated;
grant all on public.class_slots to service_role;

-- ---------- Class files (deleted automatically 90 days after upload) ----------
create table if not exists public.class_files (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  path text not null unique,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index if not exists class_files_student_idx on public.class_files (student_id, created_at desc);
create index if not exists class_files_age_idx on public.class_files (created_at);
alter table public.class_files enable row level security;
create policy class_files_read on public.class_files for select using (public.can_see_student(student_id));
create policy class_files_add on public.class_files for insert
  with check (public.can_see_student(student_id) and uploaded_by = auth.uid() and path like student_id::text || '/%');
create policy class_files_remove on public.class_files for delete
  using (uploaded_by = auth.uid() or public.my_role() = 'admin');
grant select, delete on public.class_files to authenticated;
grant insert (student_id, file_name, path, size_bytes) on public.class_files to authenticated;
grant all on public.class_files to service_role;

-- Private storage bucket, 10 MB per file. Files live under <student id>/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('class-files', 'class-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.student_from_path(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.student_from_path(text) to authenticated;

drop policy if exists avelon_class_files_read on storage.objects;
drop policy if exists avelon_class_files_upload on storage.objects;
drop policy if exists avelon_class_files_remove on storage.objects;
create policy avelon_class_files_read on storage.objects for select to authenticated
  using (bucket_id = 'class-files' and public.can_see_student(public.student_from_path(name)));
create policy avelon_class_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'class-files' and public.can_see_student(public.student_from_path(name)));
create policy avelon_class_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'class-files' and (owner_id = auth.uid()::text or public.my_role() = 'admin'));

-- ---------- Storage usage (admin portal + weekly warning email) ----------
create or replace function public.usage_report()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and public.my_role() is distinct from 'admin' then
    raise exception 'Not allowed';
  end if;
  return json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'file_bytes', coalesce((select sum(size_bytes) from public.class_files), 0),
    'file_count', (select count(*) from public.class_files));
end $$;
revoke execute on function public.usage_report() from public, anon;
grant execute on function public.usage_report() to authenticated, service_role;
