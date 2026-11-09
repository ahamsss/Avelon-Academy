-- Classes no longer need confirming. A logged class is billed automatically after 48 hours
-- unless the parent reports a problem first.
select cron.unschedule('avelon-auto-approve');
select cron.schedule('avelon-auto-approve', '0 * * * *', $$
  update public.sessions
     set status = 'approved', approved_by = 'auto', approved_at = now()
   where status = 'pending' and created_at < now() - interval '48 hours';
$$);

-- Families can only report a problem (no confirming), only the parent (account holder), only within 48 hours.
create or replace function public.review_session(p_session uuid, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_action <> 'flag' then raise exception 'Unknown action'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Please tell us briefly what went wrong.'; end if;
  update public.sessions se
     set status = 'flagged', approved_by = null, approved_at = null, flag_reason = left(trim(p_reason), 500)
   where se.id = p_session
     and se.status = 'pending'
     and se.created_at > now() - interval '48 hours'
     and exists (select 1 from public.students s where s.id = se.student_id and s.parent_id = auth.uid());
  if not found then raise exception 'The 48 hours to report a problem with this class have passed. Please message us instead.'; end if;
end; $$;
