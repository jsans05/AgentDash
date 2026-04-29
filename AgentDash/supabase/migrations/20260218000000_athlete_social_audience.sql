-- Athlete social and audience data imported from Excel

create table if not exists public.athlete_social_data (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (athlete_id) on delete cascade,
  talent_id text,
  name_raw text,
  total_followers bigint,
  avg_er_20p numeric,
  total_lifetime_posts bigint,
  ig_followers bigint,
  avg_er_ig_20p numeric,
  ig_lifetime_posts bigint,
  tt_followers bigint,
  avg_er_tt_20p numeric,
  tt_lifetime_posts bigint,
  fb_followers bigint,
  avg_er_fb_20p numeric,
  fb_lifetime_posts bigint,
  x_followers bigint,
  avg_er_x_20p numeric,
  x_lifetime_posts bigint,
  source_file_name text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists athlete_social_data_athlete_id_key
  on public.athlete_social_data (athlete_id);

create index if not exists athlete_social_data_talent_id_idx
  on public.athlete_social_data (talent_id);

create index if not exists athlete_social_data_athlete_id_idx
  on public.athlete_social_data (athlete_id);


-- Audience data by category/name for each athlete

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'audience_category_enum'
  ) then
    create type public.audience_category_enum as enum (
      'Brands',
      'Cities',
      'Combined_Age',
      'Countries',
      'Ethnicity',
      'Gender',
      'Interests',
      'States'
    );
  end if;
end
$$;

create table if not exists public.athlete_audience_data (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (athlete_id) on delete cascade,
  talent_id text,
  name_raw text,
  audience_category public.audience_category_enum not null,
  audience_name text not null,
  ig_audience_percent numeric,
  ig_audience_count bigint,
  current_ig_following bigint,
  source_file_name text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists athlete_audience_data_unique_row
  on public.athlete_audience_data (athlete_id, audience_category, audience_name);

create index if not exists athlete_audience_data_athlete_id_idx
  on public.athlete_audience_data (athlete_id);

create index if not exists athlete_audience_data_talent_id_idx
  on public.athlete_audience_data (talent_id);

create index if not exists athlete_audience_data_category_idx
  on public.athlete_audience_data (audience_category);

