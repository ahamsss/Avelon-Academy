-- Admin edits everything about a student's subject row (name, grade, subject, student email, tutor, rate, trial, active).
create or replace function public.admin_edit_student(
  p_student uuid, p_first_name text, p_grade text, p_subject text, p_student_email text,
  p_tutor uuid, p_rate_cents integer, p_trial_status text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Admins only'; end if;
  if coalesce(trim(p_first_name), '') = '' then raise exception 'Please enter the student''s first name.'; end if;
  if p_grade not in ('Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10') then raise exception 'Please pick a grade.'; end if;
  if coalesce(trim(p_subject), '') = '' then raise exception 'Please pick a subject.'; end if;
  if nullif(trim(p_student_email), '') is not null and trim(p_student_email) !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'The student''s email doesn''t look right.'; end if;
  if p_rate_cents is not null and (p_rate_cents < 0 or p_rate_cents > 50000) then raise exception 'Rate should be between $0 and $500.'; end if;
  if p_tutor is not null and not exists (select 1 from public.profiles where id = p_tutor and role in ('tutor','admin')) then
    raise exception 'That person is not a tutor.';
  end if;
  update public.students
     set first_name = left(trim(p_first_name), 60), grade = p_grade, subject = left(trim(p_subject), 40),
         student_email = lower(nullif(trim(p_student_email), '')),
         tutor_id = p_tutor, rate_cents = p_rate_cents,
         trial_status = coalesce(p_trial_status, trial_status), active = coalesce(p_active, active)
   where id = p_student;
end; $$;
revoke all on function public.admin_edit_student(uuid, text, text, text, text, uuid, integer, text, boolean) from public, anon;
grant execute on function public.admin_edit_student(uuid, text, text, text, text, uuid, integer, text, boolean) to authenticated;
