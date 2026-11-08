-- Families see only the first name of the tutors teaching their own students.
create or replace function public.my_tutor_names()
returns table (id uuid, first_name text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, split_part(coalesce(nullif(trim(p.full_name), ''), 'Your tutor'), ' ', 1)
  from students s join profiles p on p.id = s.tutor_id
  where s.parent_id = auth.uid() or (s.student_email is not null and lower(s.student_email) = my_email());
$$;
revoke all on function public.my_tutor_names() from public, anon;
grant execute on function public.my_tutor_names() to authenticated;
