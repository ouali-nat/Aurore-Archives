-- Aurore — référentiel pédagogique administrable
create table if not exists public.aurore_pedagogical_nodes (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid null references public.aurore_pedagogical_nodes(id) on delete restrict,
  node_key text not null unique,
  legacy_path text null unique,
  name text not null check (length(btrim(name)) > 0),
  node_type text not null default 'other'
    check (node_type in ('pathway','level','group','series','class','domain','formation','year','semester','branch','other')),
  slug text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  source text not null default 'admin'
    check (source in ('legacy','admin')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aurore_pedagogical_nodes_parent_idx on public.aurore_pedagogical_nodes(parent_id,active,sort_order);
create index if not exists aurore_pedagogical_nodes_type_idx on public.aurore_pedagogical_nodes(node_type,active,sort_order);
create unique index if not exists aurore_pedagogical_nodes_sibling_name_idx on public.aurore_pedagogical_nodes(
  coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(btrim(name))
);

create table if not exists public.aurore_pedagogical_subjects (
  id uuid primary key default gen_random_uuid(),
  subject_key text not null unique,
  name text not null check (length(btrim(name)) > 0),
  code text null,
  sort_order integer not null default 0,
  active boolean not null default true,
  source text not null default 'admin'
    check (source in ('legacy','admin')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists aurore_pedagogical_subjects_name_idx on public.aurore_pedagogical_subjects(lower(btrim(name)));
create index if not exists aurore_pedagogical_subjects_active_idx on public.aurore_pedagogical_subjects(active,sort_order,name);

create table if not exists public.aurore_pedagogical_node_subjects (
  node_id uuid not null references public.aurore_pedagogical_nodes(id) on delete cascade,
  subject_id uuid not null references public.aurore_pedagogical_subjects(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(node_id,subject_id)
);
create index if not exists aurore_pedagogical_node_subjects_subject_idx on public.aurore_pedagogical_node_subjects(subject_id,sort_order);

alter table public.aurore_pedagogical_nodes enable row level security;
alter table public.aurore_pedagogical_subjects enable row level security;
alter table public.aurore_pedagogical_node_subjects enable row level security;

drop policy if exists "Aurore pedagogical nodes public active read" on public.aurore_pedagogical_nodes;
create policy "Aurore pedagogical nodes public active read" on public.aurore_pedagogical_nodes for select to anon,authenticated using (active=true);
drop policy if exists "Aurore pedagogical nodes admin full access" on public.aurore_pedagogical_nodes;
create policy "Aurore pedagogical nodes admin full access" on public.aurore_pedagogical_nodes for all to authenticated using ((select private.is_aurora_admin())) with check ((select private.is_aurora_admin()));

drop policy if exists "Aurore pedagogical subjects public active read" on public.aurore_pedagogical_subjects;
create policy "Aurore pedagogical subjects public active read" on public.aurore_pedagogical_subjects for select to anon,authenticated using (active=true);
drop policy if exists "Aurore pedagogical subjects admin full access" on public.aurore_pedagogical_subjects;
create policy "Aurore pedagogical subjects admin full access" on public.aurore_pedagogical_subjects for all to authenticated using ((select private.is_aurora_admin())) with check ((select private.is_aurora_admin()));

drop policy if exists "Aurore pedagogical node subjects public active read" on public.aurore_pedagogical_node_subjects;
create policy "Aurore pedagogical node subjects public active read" on public.aurore_pedagogical_node_subjects for select to anon,authenticated using (
  exists (
    select 1 from public.aurore_pedagogical_nodes n
    join public.aurore_pedagogical_subjects s on s.id=aurore_pedagogical_node_subjects.subject_id
    where n.id=aurore_pedagogical_node_subjects.node_id and n.active=true and s.active=true
  )
);
drop policy if exists "Aurore pedagogical node subjects admin full access" on public.aurore_pedagogical_node_subjects;
create policy "Aurore pedagogical node subjects admin full access" on public.aurore_pedagogical_node_subjects for all to authenticated using ((select private.is_aurora_admin())) with check ((select private.is_aurora_admin()));

grant select on public.aurore_pedagogical_nodes to anon,authenticated;
grant all on public.aurore_pedagogical_nodes to authenticated;
grant select on public.aurore_pedagogical_subjects to anon,authenticated;
grant all on public.aurore_pedagogical_subjects to authenticated;
grant select on public.aurore_pedagogical_node_subjects to anon,authenticated;
grant all on public.aurore_pedagogical_node_subjects to authenticated;
