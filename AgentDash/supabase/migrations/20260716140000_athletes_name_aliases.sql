-- Persistent alternate names for Metabase / import matching (e.g. Caity Simmers → Caitlin Simmers)

alter table public.athletes
  add column if not exists name_aliases text[] not null default '{}';

comment on column public.athletes.name_aliases is
  'Alternate display names used when matching imports (nicknames, typos). Canonical name remains first_name + last_name.';
