-- My Avelon: a student with their own login (matched by email) can see and confirm their own classes.
drop policy if exists sessions_read_student on public.sessions;
create policy sessions_read_student on public.sessions for select
  using (exists (select 1 from public.students s
                 where s.id = sessions.student_id
                   and s.student_email is not null and lower(s.student_email) = public.my_email()));

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
     and exists (select 1 from public.students s where s.id = se.student_id
                   and (s.parent_id = auth.uid()
                        or (s.student_email is not null and lower(s.student_email) = public.my_email())));
  if not found then raise exception 'This class can no longer be changed.'; end if;
end; $$;
