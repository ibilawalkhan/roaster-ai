-- A person's primary job role/title (Kitchen, Front of House, Cashier, …),
-- distinct from their ACCESS role (app_user.role = manager|staff). The roster
-- UI shows this per person and uses it as the default role for new shifts.
-- Kept as free text because job titles vary per business).

alter table public.app_user
  add column position text;

comment on column public.app_user.position is
  'Primary job role/title (e.g. Kitchen, Front of House). Distinct from access role.';
