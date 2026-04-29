-- Rescale ig_audience_percent when Excel provided fractional values (e.g. 0.8 => 80%)

update public.athlete_audience_data
set
  ig_audience_percent = ig_audience_percent * 100,
  updated_at = now()
where
  ig_audience_percent is not null
  and ig_audience_percent >= 0
  and ig_audience_percent < 1.0000001;

