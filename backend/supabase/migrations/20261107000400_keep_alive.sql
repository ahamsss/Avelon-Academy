-- Tiny public function the daily GitHub Action calls so the free Supabase project never pauses.
create or replace function public.keep_alive()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;
revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
