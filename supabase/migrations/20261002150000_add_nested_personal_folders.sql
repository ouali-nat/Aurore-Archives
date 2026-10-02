-- Allow personal cases to contain nested subfolders without changing existing root cases.
alter table public.cases_personnelles
  add column if not exists parent_id uuid null;

alter table public.cases_personnelles
  drop constraint if exists cases_personnelles_parent_id_fkey;

alter table public.cases_personnelles
  add constraint cases_personnelles_parent_id_fkey
  foreign key (parent_id)
  references public.cases_personnelles(id)
  on delete restrict;

create index if not exists cases_personnelles_user_parent_position_idx
  on public.cases_personnelles(user_id, parent_id, "position");

create index if not exists cases_personnelles_parent_idx
  on public.cases_personnelles(parent_id);
