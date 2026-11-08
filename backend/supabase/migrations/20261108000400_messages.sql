-- Messages between tutor and family about one student's subject. Parent, student (own login), tutor and admin all see the thread.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_name text not null,
  sender_role text not null check (sender_role in ('parent','student','tutor','admin')),
  body text not null check (char_length(body) between 1 and 2000),
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_student_idx on public.messages (student_id, created_at);
alter table public.messages enable row level security;
create policy messages_read on public.messages for select to authenticated using (public.can_see_student(student_id));
create policy messages_admin_update on public.messages for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy messages_admin_delete on public.messages for delete to authenticated using (public.my_role() = 'admin');
-- Inserts only through the send-message function (service role), which checks access and sends alerts.

-- When each person last opened a thread (for unread counts).
create table if not exists public.message_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, student_id)
);
alter table public.message_reads enable row level security;
create policy message_reads_own on public.message_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_see_student(student_id));

-- When an email alert last went to someone about a thread (so a burst of messages sends one email).
create table if not exists public.message_notices (
  student_id uuid not null references public.students(id) on delete cascade,
  email text not null,
  sent_at timestamptz not null default now(),
  primary key (student_id, email)
);
alter table public.message_notices enable row level security;

grant select, update, delete on public.messages to authenticated;
grant select, insert, update on public.message_reads to authenticated;
grant select, insert, update, delete on public.messages, public.message_reads, public.message_notices to service_role;
