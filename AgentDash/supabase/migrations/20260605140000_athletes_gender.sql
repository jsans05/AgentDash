alter table public.athletes
add column if not exists gender text check (gender in ('female', 'male', 'non_binary'));

comment on column public.athletes.gender is 'Athlete gender for roster basic info and Mystery Machine prospecting. Null for property/team entries.';
