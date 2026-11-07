-- The trial form no longer asks for class type; families request small groups in the portal instead.
alter table public.trial_requests drop column if exists format;
