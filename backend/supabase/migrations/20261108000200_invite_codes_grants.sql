-- Backend functions must be able to read and write sign-in codes.
grant select, insert, update, delete on public.invite_codes to service_role;
