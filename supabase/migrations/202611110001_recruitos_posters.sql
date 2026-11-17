-- MoSahay RecruitOS: recruiter-authored job poster content and export history.
alter table public.jobs
  add column if not exists vacancies integer check(vacancies is null or vacancies between 1 and 10000),
  add column if not exists salary_min numeric(14,2) check(salary_min is null or salary_min >= 0),
  add column if not exists salary_max numeric(14,2) check(salary_max is null or salary_max >= 0),
  add column if not exists salary_currency text not null default 'INR',
  add column if not exists experience_min numeric(4,1) check(experience_min is null or experience_min >= 0),
  add column if not exists experience_max numeric(4,1) check(experience_max is null or experience_max >= 0),
  add column if not exists application_deadline date,
  add column if not exists department text,
  add column if not exists industry text;

create table public.job_posters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check(char_length(title) between 1 and 180),
  template_id text not null check(template_id in (
    'corporate','manufacturing','warehouse','logistics','retail','technology',
    'fresher','walkin','urgent','hospitality','healthcare','skilled-trades'
  )),
  format text not null check(format in ('square','portrait','story','linkedin','whatsapp','a4')),
  language text not null default 'en' check(language in ('en','hi','or')),
  poster_copy jsonb not null default '{}'::jsonb,
  style jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check(status in ('draft','approved','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_posters_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete cascade
);
create index job_posters_org_history_idx on public.job_posters(org_id,created_at desc);
create index job_posters_job_history_idx on public.job_posters(job_id,created_at desc);
alter table public.job_posters enable row level security;
create policy job_posters_read_member on public.job_posters for select to authenticated using(public.is_org_member(org_id));
create policy job_posters_insert_writer on public.job_posters for insert to authenticated
  with check(public.has_org_role(org_id,array['owner','admin','recruiter']::public.workspace_role[]) and created_by=auth.uid());
create policy job_posters_update_writer on public.job_posters for update to authenticated
  using(public.has_org_role(org_id,array['owner','admin','recruiter']::public.workspace_role[]))
  with check(public.has_org_role(org_id,array['owner','admin','recruiter']::public.workspace_role[]));
create policy job_posters_delete_admin on public.job_posters for delete to authenticated
  using(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]));
