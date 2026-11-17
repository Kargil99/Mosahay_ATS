-- Public career listings expose only fields explicitly approved for publication.
alter table public.jobs
  add column public_slug text,
  add column public_listing_enabled boolean not null default false;
create unique index jobs_public_slug_org_idx on public.jobs(org_id,public_slug) where public_slug is not null;

-- Public applicants can submit the same resume as an existing candidate. Keep
-- the checksum indexed without forcing a private candidate merge.
alter table public.resume_assets drop constraint if exists resume_assets_org_id_sha256_key;
create index if not exists resume_assets_org_sha256_idx on public.resume_assets(org_id,sha256);

create table public.candidate_portal_access (
  token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
  org_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint candidate_portal_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete cascade,
  constraint candidate_portal_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete cascade
);
alter table public.candidate_portal_access enable row level security;
revoke all on public.candidate_portal_access from anon,authenticated,public;

drop function if exists public.public_job_list(uuid,text,text);
create or replace function public.public_job_list(
  p_org_id uuid,p_search text default null,p_location text default null,p_industry text default null,
  p_salary_min numeric default null,p_salary_max numeric default null,
  p_experience_min numeric default null,p_experience_max numeric default null,p_employment_type text default null
)
returns table(
  id uuid, slug text, title text, description text, location text, work_arrangement text,
  employment_type text, salary_min numeric, salary_max numeric, salary_currency text,
  experience_min numeric, experience_max numeric, vacancies integer, application_deadline date,
  department text, industry text, organization_name text, created_at timestamptz
)
language sql stable security definer set search_path=public,pg_temp as $$
  select j.id,j.public_slug,j.title,j.description,j.location,j.work_arrangement,j.employment_type,
    j.salary_min,j.salary_max,j.salary_currency,j.experience_min,j.experience_max,j.vacancies,
    j.application_deadline,j.department,j.industry,o.name,j.created_at
  from public.jobs j join public.organizations o on o.id=j.org_id
  where j.org_id=p_org_id and j.status='open' and j.public_listing_enabled and j.public_slug is not null
    and (nullif(trim(p_search),'') is null or j.title ilike '%'||left(trim(p_search),80)||'%' or j.description ilike '%'||left(trim(p_search),80)||'%')
    and (nullif(trim(p_location),'') is null or coalesce(j.location,'') ilike '%'||left(trim(p_location),80)||'%')
    and (nullif(trim(p_industry),'') is null or coalesce(j.industry,'') ilike '%'||left(trim(p_industry),80)||'%')
    and (p_salary_min is null or j.salary_max is null or j.salary_max>=p_salary_min)
    and (p_salary_max is null or j.salary_min is null or j.salary_min<=p_salary_max)
    and (p_experience_min is null or j.experience_max is null or j.experience_max>=p_experience_min)
    and (p_experience_max is null or j.experience_min is null or j.experience_min<=p_experience_max)
    and (nullif(trim(p_employment_type),'') is null or j.employment_type=p_employment_type)
    and (j.application_deadline is null or j.application_deadline>=current_date)
  order by j.created_at desc limit 100
$$;
revoke all on function public.public_job_list(uuid,text,text,text,numeric,numeric,numeric,numeric,text) from public;
grant execute on function public.public_job_list(uuid,text,text,text,numeric,numeric,numeric,numeric,text) to anon,authenticated;

create or replace function public.public_job_detail(p_org_id uuid,p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare detail_row jsonb;
begin
  select jsonb_build_object(
    'id',j.id,'slug',j.public_slug,'title',j.title,'description',j.description,'location',j.location,
    'work_arrangement',j.work_arrangement,'employment_type',j.employment_type,
    'salary_min',j.salary_min,'salary_max',j.salary_max,'salary_currency',j.salary_currency,
    'experience_min',j.experience_min,'experience_max',j.experience_max,'vacancies',j.vacancies,
    'application_deadline',j.application_deadline,'department',j.department,'industry',j.industry,
    'organization_name',o.name,'privacy_notice_text',o.privacy_notice_text,'privacy_notice_version',o.privacy_notice_version
  ) into detail_row
  from public.jobs j join public.organizations o on o.id=j.org_id
  where j.org_id=p_org_id and j.public_slug=p_slug and j.status='open' and j.public_listing_enabled
    and (j.application_deadline is null or j.application_deadline>=current_date);
  if detail_row is null then raise exception 'public job not found'; end if;
  return detail_row;
end $$;
revoke all on function public.public_job_detail(uuid,text) from public;
grant execute on function public.public_job_detail(uuid,text) to anon,authenticated;

create or replace function public.get_public_candidate_portal(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result_row jsonb;
begin
  select jsonb_build_object(
    'candidate',jsonb_build_object('full_name',c.full_name,'email',c.email,'phone',c.phone,'skills',c.skills,
      'consent_status',c.consent_status,'privacy_notice_version',c.privacy_notice_version,
      'city',coalesce(r.profile_json->>'city',''),'preferred_location',coalesce(r.profile_json->>'preferred_location',''),
      'availability',coalesce(r.profile_json->>'availability',''),
      'experience_years',r.profile_json->'approximate_experience_years'),
    'application',jsonb_build_object('job_title',j.title,'location',j.location,'stage',a.stage,'status',a.status,'submitted_at',a.created_at),
    'privacy_notice_text',o.privacy_notice_text
  ) into result_row
  from public.candidate_portal_access t
  join public.candidates c on c.id=t.candidate_id and c.org_id=t.org_id
  join public.applications a on a.id=t.application_id and a.candidate_id=c.id and a.org_id=t.org_id
  join public.jobs j on j.id=a.job_id and j.org_id=t.org_id
  join public.organizations o on o.id=t.org_id
  left join lateral(select ra.profile_json from public.resume_assets ra where ra.org_id=t.org_id and ra.candidate_id=c.id order by ra.created_at desc limit 1) r on true
  where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now();
  if result_row is null then raise exception 'candidate portal access is invalid'; end if;
  return result_row;
end $$;
revoke all on function public.get_public_candidate_portal(text) from public;
grant execute on function public.get_public_candidate_portal(text) to anon,authenticated;

create or replace function public.update_public_candidate_profile(
  p_token_hash text,p_phone text,p_city text,p_preferred_location text,p_availability text,p_skills jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate_row public.candidates%rowtype; safe_skills jsonb := case when jsonb_typeof(p_skills)='array' then p_skills else '[]'::jsonb end;
begin
  select c.* into candidate_row from public.candidate_portal_access t join public.candidates c on c.id=t.candidate_id and c.org_id=t.org_id
    where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now();
  if not found then raise exception 'candidate portal access is invalid'; end if;
  if length(trim(coalesce(p_phone,''))) not between 7 and 40 then raise exception 'invalid phone'; end if;
  if length(coalesce(p_city,''))>120 or length(coalesce(p_preferred_location,''))>120 or length(coalesce(p_availability,''))>120 then raise exception 'profile field too long'; end if;
  update public.candidates set phone=trim(p_phone),skills=safe_skills,updated_at=now() where id=candidate_row.id and org_id=candidate_row.org_id;
  update public.resume_assets set profile_json=profile_json||jsonb_build_object(
    'city',trim(coalesce(p_city,'')),'preferred_location',trim(coalesce(p_preferred_location,'')),
    'availability',trim(coalesce(p_availability,'')),'skills',safe_skills)
  ) where id=(select id from public.resume_assets where candidate_id=candidate_row.id and org_id=candidate_row.org_id order by created_at desc limit 1);
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(candidate_row.org_id,null,'candidate',candidate_row.id,'candidate_self_service_profile_updated','{}'::jsonb);
end $$;
revoke all on function public.update_public_candidate_profile(text,text,text,text,text,jsonb) from public;
grant execute on function public.update_public_candidate_profile(text,text,text,text,text,jsonb) to anon,authenticated;

create or replace function public.withdraw_public_candidate_consent(p_token_hash text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate_row public.candidates%rowtype;
begin
  select c.* into candidate_row from public.candidate_portal_access t join public.candidates c on c.id=t.candidate_id and c.org_id=t.org_id
    where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now();
  if not found then raise exception 'candidate portal access is invalid'; end if;
  update public.candidates set consent_status='withdrawn',updated_at=now() where id=candidate_row.id and org_id=candidate_row.org_id;
  update public.applications set status='withdrawn',updated_at=now() where candidate_id=candidate_row.id and org_id=candidate_row.org_id and status='active';
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(candidate_row.org_id,null,'candidate',candidate_row.id,'candidate_consent_withdrawn','{}'::jsonb);
end $$;
revoke all on function public.withdraw_public_candidate_consent(text) from public;
grant execute on function public.withdraw_public_candidate_consent(text) to anon,authenticated;

create or replace function public.create_public_candidate_privacy_request(p_token_hash text,p_request_type text,p_details text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate_row public.candidates%rowtype; request_id uuid;
begin
  select c.* into candidate_row from public.candidate_portal_access t join public.candidates c on c.id=t.candidate_id and c.org_id=t.org_id
    where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now();
  if not found then raise exception 'candidate portal access is invalid'; end if;
  if p_request_type not in ('access','correction','export','consent_withdrawal','deletion') then raise exception 'invalid request type'; end if;
  if length(trim(coalesce(p_details,''))) not between 3 and 5000 then raise exception 'request details are invalid'; end if;
  insert into public.privacy_requests(org_id,candidate_id,requested_by,request_type,details)
    values(candidate_row.org_id,candidate_row.id,null,p_request_type,left(trim(p_details),5000)) returning id into request_id;
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(candidate_row.org_id,null,'candidate',candidate_row.id,'candidate_privacy_request_received',jsonb_build_object('request_type',p_request_type));
  return request_id;
end $$;
revoke all on function public.create_public_candidate_privacy_request(text,text,text) from public;
grant execute on function public.create_public_candidate_privacy_request(text,text,text) to anon,authenticated;

create or replace function public.submit_public_job_application(
  p_org_id uuid,p_slug text,p_candidate_id uuid,p_full_name text,p_email text,p_phone text,
  p_city text,p_preferred_location text,p_experience numeric,p_skills jsonb,p_availability text,
  p_consent boolean,p_notice_version text,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint,
  p_sha256 text,p_parse_status text,p_parsing_warnings jsonb,p_parsed_text text,p_profile_json jsonb,
  p_portal_token_hash text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  job_row public.jobs%rowtype;
  org_row public.organizations%rowtype;
  application_id uuid;
  duplicate_email boolean;
  duplicate_resume boolean;
  safe_skills jsonb := case when jsonb_typeof(p_skills)='array' then p_skills else '[]'::jsonb end;
  safe_profile jsonb;
begin
  if p_consent is distinct from true then raise exception 'candidate consent is required'; end if;
  if length(trim(coalesce(p_full_name,''))) not between 2 and 180 then raise exception 'invalid candidate name'; end if;
  if length(trim(coalesce(p_email,''))) not between 5 and 254 or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid candidate email'; end if;
  if length(trim(coalesce(p_phone,''))) not between 7 and 40 then raise exception 'invalid candidate phone'; end if;
  if p_experience is not null and not (0 <= p_experience and p_experience <= 80) then raise exception 'invalid experience'; end if;
  if p_size_bytes is null or not (1 <= p_size_bytes and p_size_bytes <= 10485760) then raise exception 'invalid resume size'; end if;
  if p_mime_type not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain') then raise exception 'invalid resume type'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid resume checksum'; end if;
  if p_portal_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid candidate portal access'; end if;
  if length(coalesce(p_parsed_text,''))>200000 then raise exception 'resume text is too long'; end if;
  if p_parse_status not in ('parsed','needs_manual_review') then raise exception 'invalid parsing status'; end if;
  if left(p_storage_path,length('public-applications/'||p_org_id::text||'/'))<>'public-applications/'||p_org_id::text||'/'
     or position('/'||p_candidate_id::text||'/' in p_storage_path)=0 then raise exception 'invalid resume path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='candidate-resumes' and name=p_storage_path) then raise exception 'resume file missing'; end if;

  select * into job_row from public.jobs
    where org_id=p_org_id and public_slug=p_slug and public_listing_enabled and status='open'
      and (application_deadline is null or application_deadline>=current_date);
  if not found then raise exception 'public job not found'; end if;
  select * into org_row from public.organizations where id=p_org_id;
  if p_notice_version is distinct from org_row.privacy_notice_version then raise exception 'privacy notice changed'; end if;
  safe_profile := coalesce(p_profile_json,'{}'::jsonb) || jsonb_build_object(
    'city',left(coalesce(p_city,''),120),'preferred_location',left(coalesce(p_preferred_location,''),120),
    'approximate_experience_years',p_experience,'availability',left(coalesce(p_availability,''),120));
  duplicate_email := exists(select 1 from public.candidates where org_id=p_org_id and normalized_email=lower(trim(p_email)) and deleted_at is null);
  duplicate_resume := exists(select 1 from public.resume_assets where org_id=p_org_id and sha256=p_sha256);
  if duplicate_email then p_parsing_warnings := coalesce(p_parsing_warnings,'[]'::jsonb) || jsonb_build_array('Possible duplicate by normalized email; review before linking or merging.'); end if;
  if duplicate_resume then p_parsing_warnings := coalesce(p_parsing_warnings,'[]'::jsonb) || jsonb_build_array('Possible duplicate resume file; review before linking or merging.'); end if;

  insert into public.candidates(id,org_id,full_name,email,normalized_email,phone,current_title,current_employer,skills,source,
    consent_status,privacy_notice_version,notice_recorded_at,parse_status,parsing_warnings,retention_due_at)
  values(p_candidate_id,p_org_id,trim(p_full_name),lower(trim(p_email)),lower(trim(p_email)),trim(p_phone),
    nullif(p_profile_json->>'current_title',''),nullif(p_profile_json->>'current_employer',''),safe_skills,'public_job_board',
    'recorded',org_row.privacy_notice_version,now(),p_parse_status,coalesce(p_parsing_warnings,'[]'::jsonb),now()+make_interval(days=>org_row.retention_days));

  insert into public.resume_assets(org_id,candidate_id,storage_path,original_filename,mime_type,size_bytes,sha256,
    parse_status,parsed_at,parsed_text,profile_json)
  values(p_org_id,p_candidate_id,p_storage_path,left(regexp_replace(coalesce(p_original_filename,'resume'),'[^[:alnum:]_.() -]','','g'),180),
    p_mime_type,p_size_bytes,p_sha256,p_parse_status,now(),p_parsed_text,safe_profile);

  insert into public.candidate_experiences(org_id,candidate_id,title,employer,start_date,end_date,is_current,description,evidence_quote)
    select p_org_id,p_candidate_id,x->>'title',x->>'employer',nullif(x->>'start_date','')::date,nullif(x->>'end_date','')::date,
      coalesce((x->>'is_current')::boolean,false),x->>'description',x->>'evidence_quote'
    from jsonb_array_elements(case when jsonb_typeof(safe_profile->'experiences')='array' then safe_profile->'experiences' else '[]'::jsonb end) x;
  insert into public.candidate_educations(org_id,candidate_id,institution,qualification,field_of_study,year_completed,evidence_quote)
    select p_org_id,p_candidate_id,x->>'institution',x->>'qualification',x->>'field_of_study',
      case when (x->>'year_completed') ~ '^\d{4}$' then (x->>'year_completed')::integer else null end,x->>'evidence_quote'
    from jsonb_array_elements(case when jsonb_typeof(safe_profile->'educations')='array' then safe_profile->'educations' else '[]'::jsonb end) x;
  insert into public.candidate_skills(org_id,candidate_id,skill,source)
    select p_org_id,p_candidate_id,trim(value),'public_application'
    from jsonb_array_elements_text(safe_skills) s(value) where length(trim(value)) between 1 and 100;

  insert into public.applications(org_id,candidate_id,job_id,owner_id,stage,status)
    values(p_org_id,p_candidate_id,job_row.id,null,'New','active') returning id into application_id;
  insert into public.candidate_portal_access(token_hash,org_id,candidate_id,application_id,expires_at)
    values(p_portal_token_hash,p_org_id,p_candidate_id,application_id,now()+interval '365 days');
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(p_org_id,null,'application',application_id,'public_application_received',jsonb_build_object('job_id',job_row.id,'source','public_job_board','city',left(coalesce(p_city,''),120),'preferred_location',left(coalesce(p_preferred_location,''),120),'experience_years',p_experience,'availability',left(coalesce(p_availability,''),120)));
  return jsonb_build_object('application_id',application_id,'duplicate_email',duplicate_email,'duplicate_resume',duplicate_resume);
end $$;
revoke all on function public.submit_public_job_application(uuid,text,uuid,text,text,text,text,text,numeric,jsonb,text,boolean,text,text,text,text,bigint,text,text,jsonb,text,jsonb,text) from public;
grant execute on function public.submit_public_job_application(uuid,text,uuid,text,text,text,text,text,numeric,jsonb,text,boolean,text,text,text,text,bigint,text,text,jsonb,text,jsonb,text) to anon,authenticated;

create table public.employer_leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_name text not null check(char_length(company_name) between 2 and 180),
  website text,
  contact_name text not null check(char_length(contact_name) between 2 and 180),
  email text not null check(char_length(email) between 5 and 254),
  phone text not null check(char_length(phone) between 7 and 40),
  job_title text not null check(char_length(job_title) between 2 and 180),
  vacancies integer not null default 1 check(vacancies between 1 and 10000),
  required_skills jsonb not null default '[]'::jsonb,
  location text not null check(char_length(location) between 1 and 180),
  experience text,
  salary_min numeric(14,2) check(salary_min is null or salary_min>=0),
  salary_max numeric(14,2) check(salary_max is null or salary_max>=0),
  hiring_timeline text not null check(char_length(hiring_timeline) between 2 and 180),
  status text not null default 'new' check(status in ('new','contacted','qualified','converted','declined')),
  converted_client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(salary_min is null or salary_max is null or salary_max>=salary_min)
);
create index employer_leads_org_status_idx on public.employer_leads(org_id,status,created_at desc);
alter table public.employer_leads enable row level security;
create policy employer_leads_read_manager on public.employer_leads for select to authenticated
  using(public.has_org_role(org_id,array['owner','admin','recruitment_manager']::public.workspace_role[]));
create policy employer_leads_update_manager on public.employer_leads for update to authenticated
  using(public.has_org_role(org_id,array['owner','admin','recruitment_manager']::public.workspace_role[]))
  with check(public.has_org_role(org_id,array['owner','admin','recruitment_manager']::public.workspace_role[]));
revoke all on public.employer_leads from anon,authenticated,public;
grant select,update on public.employer_leads to authenticated;

create or replace function public.submit_employer_lead(
  p_org_id uuid,p_company_name text,p_website text,p_contact_name text,p_email text,p_phone text,
  p_job_title text,p_vacancies integer,p_required_skills jsonb,p_location text,p_experience text,
  p_salary_min numeric,p_salary_max numeric,p_hiring_timeline text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare lead_id uuid; safe_skills jsonb := case when jsonb_typeof(p_required_skills)='array' then p_required_skills else '[]'::jsonb end;
begin
  if length(trim(coalesce(p_company_name,''))) not between 2 and 180 then raise exception 'invalid company name'; end if;
  if length(trim(coalesce(p_contact_name,''))) not between 2 and 180 then raise exception 'invalid contact name'; end if;
  if length(trim(coalesce(p_email,''))) not between 5 and 254 or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid business email'; end if;
  if length(trim(coalesce(p_phone,''))) not between 7 and 40 then raise exception 'invalid phone'; end if;
  if length(trim(coalesce(p_job_title,''))) not between 2 and 180 then raise exception 'invalid job title'; end if;
  if p_vacancies is null or not (1<=p_vacancies and p_vacancies<=10000) then raise exception 'invalid vacancy count'; end if;
  if length(trim(coalesce(p_location,''))) not between 1 and 180 then raise exception 'invalid location'; end if;
  if length(trim(coalesce(p_hiring_timeline,''))) not between 2 and 180 then raise exception 'invalid hiring timeline'; end if;
  if p_salary_min is not null and p_salary_min<0 or p_salary_max is not null and p_salary_max<0 or p_salary_min is not null and p_salary_max is not null and p_salary_max<p_salary_min then raise exception 'invalid salary range'; end if;
  if not exists(select 1 from public.organizations where id=p_org_id) then raise exception 'workspace unavailable'; end if;
  insert into public.employer_leads(org_id,company_name,website,contact_name,email,phone,job_title,vacancies,required_skills,location,experience,salary_min,salary_max,hiring_timeline)
  values(p_org_id,trim(p_company_name),nullif(trim(coalesce(p_website,'')),''),trim(p_contact_name),lower(trim(p_email)),trim(p_phone),trim(p_job_title),p_vacancies,safe_skills,trim(p_location),nullif(trim(coalesce(p_experience,'')),''),p_salary_min,p_salary_max,trim(p_hiring_timeline)) returning id into lead_id;
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
  values(p_org_id,null,'employer_lead',lead_id,'employer_lead_received',jsonb_build_object('company_name',trim(p_company_name),'job_title',trim(p_job_title)));
  return lead_id;
end $$;
revoke all on function public.submit_employer_lead(uuid,text,text,text,text,text,text,integer,jsonb,text,text,numeric,numeric,text) from public;
grant execute on function public.submit_employer_lead(uuid,text,text,text,text,text,text,integer,jsonb,text,text,numeric,numeric,text) to service_role;

create or replace function public.convert_employer_lead(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare lead_row public.employer_leads%rowtype; client_id uuid; note_text text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into lead_row from public.employer_leads where id=p_lead_id for update;
  if not found or not public.has_org_role(lead_row.org_id,array['owner','admin','recruitment_manager']::public.workspace_role[]) then raise exception 'lead unavailable'; end if;
  if lead_row.converted_client_id is not null then return lead_row.converted_client_id; end if;
  if lead_row.status<>'qualified' then raise exception 'lead must be qualified before conversion'; end if;
  note_text := format('Inbound hiring lead. Contact: %s (%s, %s). Role: %s. Vacancies: %s. Location: %s. Experience: %s. Salary: %s–%s. Timeline: %s. Skills: %s.',
    lead_row.contact_name,lead_row.email,lead_row.phone,lead_row.job_title,lead_row.vacancies,lead_row.location,
    coalesce(lead_row.experience,'not supplied'),coalesce(lead_row.salary_min::text,'not supplied'),coalesce(lead_row.salary_max::text,'not supplied'),lead_row.hiring_timeline,lead_row.required_skills::text);
  insert into public.clients(org_id,name,website,notes) values(lead_row.org_id,lead_row.company_name,lead_row.website,note_text) returning id into client_id;
  update public.employer_leads set status='converted',converted_client_id=client_id,updated_at=now() where id=lead_row.id;
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
  values(lead_row.org_id,auth.uid(),'employer_lead',lead_row.id,'employer_lead_converted',jsonb_build_object('client_id',client_id));
  return client_id;
end $$;
revoke all on function public.convert_employer_lead(uuid) from public;
grant execute on function public.convert_employer_lead(uuid) to authenticated;
