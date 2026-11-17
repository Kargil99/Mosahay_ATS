alter table public.candidates
  add column normalized_phone text generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
  ) stored;

create index candidates_phone_idx
  on public.candidates(org_id, normalized_phone)
  where normalized_phone is not null;
