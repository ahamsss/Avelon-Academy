-- Admin can remove trial requests (e.g. once booked or closed).
drop policy if exists trial_requests_admin_delete on public.trial_requests;
create policy trial_requests_admin_delete on public.trial_requests for delete
  using (public.my_role() = 'admin');
grant delete on public.trial_requests to authenticated;
