create extension if not exists pgcrypto with schema extensions;
create type public.workspace_role as enum ('owner','admin','recruiter','reviewer');
create type public.application_stage as enum ('New','Parsing','Needs Review','Shortlisted','Recruiter Screen','Submitted to Client','Interview','Offer','Hired','Rejected','Withdrawn','Talent Pool');

create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 2 and 120),
 privacy_notice_text text not null default 'Your CV and contact information are used to review your application and may be shared with the recruiting client. Contact the agency for access, correction, export, or deletion.',
 privacy_notice_version text not null default '1', retention_days integer not null default 730 check(retention_days between 1 and 3650),
 ai_processing_enabled boolean not null default false, ai_notice_acknowledged boolean not null default false,
 scoring_defaults jsonb not null default '{"version":1}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organization_members (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, role public.workspace_role not null default 'recruiter',
 created_at timestamptz not null default now(), unique(org_id,user_id)
);
create index organization_members_user_idx on public.organization_members(user_id,org_id);

create or replace function public.is_org_member(check_org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.organization_members m where m.org_id=check_org and m.user_id=auth.uid()) $$;
create or replace function public.has_org_role(check_org uuid, allowed public.workspace_role[]) returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.organization_members m where m.org_id=check_org and m.user_id=auth.uid() and m.role=any(allowed)) $$;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid,public.workspace_role[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid,public.workspace_role[]) to authenticated;
create or replace function public.create_workspace(p_name text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 if length(trim(p_name))<2 or length(trim(p_name))>120 then raise exception 'invalid workspace name'; end if;
 insert into public.organizations(name) values(trim(p_name)) returning id into new_id;
 insert into public.organization_members(org_id,user_id,role) values(new_id,auth.uid(),'owner');
 return new_id;
end $$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

create table public.clients (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, website text, notes text, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index clients_org_idx on public.clients(org_id,created_at desc);
create table public.jobs (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 client_id uuid references public.clients(id) on delete set null, owner_id uuid references auth.users(id) on delete set null,
 title text not null, description text not null default '', jd_storage_path text, location text, work_arrangement text, employment_type text,
 status text not null default 'draft' check(status in ('draft','open','paused','filled','archived')),
 scoring_version integer not null default 1 check(scoring_version>0), privacy_notice_version text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index jobs_org_idx on public.jobs(org_id,status,created_at desc);
create table public.job_reviewer_assignments (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 job_id uuid not null references public.jobs(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 assigned_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), unique(job_id,user_id)
);
create index job_reviewer_assignments_user_idx on public.job_reviewer_assignments(user_id,job_id);
create table public.job_requirements (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 job_id uuid not null references public.jobs(id) on delete cascade, criterion text not null, description text not null default '', required boolean not null default true,
 weight integer not null check(weight between 0 and 100), aliases jsonb not null default '[]'::jsonb, rubric jsonb not null default '{"scale":"0-5"}'::jsonb,
 source_status text not null default 'recruiter_confirmed' check(source_status in ('proposed','recruiter_confirmed')),
 approval_status text not null default 'approved', active boolean not null default true, rubric_version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index requirements_job_idx on public.job_requirements(job_id,active);

create table public.candidates (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 full_name text, email text, normalized_email text, phone text, current_title text, current_employer text, skills jsonb not null default '[]'::jsonb,
 source text, consent_status text not null default 'not_recorded' check(consent_status in ('not_recorded','recorded','not_required','withdrawn')),
 privacy_notice_version text, notice_recorded_at timestamptz, parse_status text not null default 'pending', parsing_warnings jsonb not null default '[]'::jsonb,
 retention_due_at timestamptz, deleted_at timestamptz, merged_into uuid references public.candidates(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index candidates_org_idx on public.candidates(org_id,created_at desc);
create index candidates_email_idx on public.candidates(org_id,normalized_email);
create table public.resume_assets (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade, storage_path text not null, original_filename text not null,
 mime_type text not null check(mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760), sha256 text not null, parse_status text not null default 'pending', parsing_error text,
 parsed_at timestamptz, parsed_text text, profile_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(org_id,sha256)
);
create index resume_assets_candidate_idx on public.resume_assets(candidate_id,created_at desc);
create table public.candidate_experiences (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade, title text, employer text, start_date date, end_date date,
 is_current boolean not null default false, description text, evidence_quote text, created_at timestamptz not null default now()
);
create table public.candidate_educations (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade, institution text, qualification text, field_of_study text,
 year_completed integer, evidence_quote text, created_at timestamptz not null default now()
);
create table public.candidate_skills (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade, skill text not null, evidence_quote text, source text not null default 'resume', created_at timestamptz not null default now()
);

create table public.applications (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete restrict, job_id uuid not null references public.jobs(id) on delete cascade,
 owner_id uuid references auth.users(id) on delete set null, stage public.application_stage not null default 'New', status text not null default 'active',
 decision text check(decision in ('hired','rejected','withdrawn')), decision_reason text, stage_changed_at timestamptz not null default now(),
 hired_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(job_id,candidate_id)
);
create index applications_org_stage_idx on public.applications(org_id,stage,created_at desc);
create index applications_job_stage_idx on public.applications(job_id,stage,created_at desc);
create table public.score_runs (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 application_id uuid not null references public.applications(id) on delete cascade, algorithm_version text not null, rubric_version integer not null,
 criteria_snapshot jsonb not null, total_score integer check(total_score between 0 and 100), evidence_coverage integer not null check(evidence_coverage between 0 and 100),
 confidence text not null, result jsonb not null, provider text not null default 'deterministic', model text, run_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index score_runs_app_idx on public.score_runs(application_id,created_at desc);
create table public.score_overrides (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 application_id uuid not null references public.applications(id) on delete cascade, score_run_id uuid references public.score_runs(id) on delete set null,
 original_score integer, override_score integer not null check(override_score between 0 and 100), reason text not null check(char_length(reason)>=5),
 actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table public.notes (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 application_id uuid not null references public.applications(id) on delete cascade, author_id uuid references auth.users(id) on delete set null,
 body text not null check(char_length(body) between 1 and 10000), created_at timestamptz not null default now()
);
create index notes_app_idx on public.notes(application_id,created_at desc);
create table public.activity_events (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null, entity_type text not null, entity_id uuid, action text not null,
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index activity_org_idx on public.activity_events(org_id,created_at desc);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null, entity_type text not null, entity_id uuid, action text not null,
 safe_metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index audit_org_idx on public.audit_logs(org_id,created_at desc);
create table public.interview_scorecards (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 application_id uuid not null references public.applications(id) on delete cascade, reviewer_id uuid references auth.users(id) on delete set null,
 blinded boolean not null default false, submitted_at timestamptz, created_at timestamptz not null default now()
);
create table public.interview_scorecard_answers (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 scorecard_id uuid not null references public.interview_scorecards(id) on delete cascade, question text not null,
 rating integer not null check(rating between 1 and 5), evidence_notes text not null default '', created_at timestamptz not null default now()
);
create table public.interview_questions (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 job_id uuid not null references public.jobs(id) on delete cascade, question text not null, rubric jsonb not null default '{}'::jsonb,
 sort_order integer not null default 0, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.privacy_requests (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 candidate_id uuid references public.candidates(id) on delete set null, requested_by uuid references auth.users(id) on delete set null,
 request_type text not null check(request_type in ('access','correction','export','consent_withdrawal','deletion')),
 details text not null, status text not null default 'open' check(status in ('open','in_progress','completed','rejected')),
 resolution_notes text, resolved_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index privacy_org_idx on public.privacy_requests(org_id,status,created_at desc);
alter table public.clients add constraint clients_id_org_unique unique(id,org_id);
alter table public.jobs add constraint jobs_id_org_unique unique(id,org_id);
alter table public.job_reviewer_assignments add constraint reviewer_assignment_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete cascade;
alter table public.jobs add constraint jobs_client_org_fk foreign key(client_id,org_id) references public.clients(id,org_id) on delete set null (client_id);
alter table public.candidates add constraint candidates_id_org_unique unique(id,org_id);
alter table public.job_requirements add constraint requirements_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete cascade;
alter table public.resume_assets add constraint resumes_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete cascade;
alter table public.candidate_experiences add constraint experiences_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete cascade;
alter table public.candidate_educations add constraint educations_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete cascade;
alter table public.candidate_skills add constraint skills_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete cascade;
alter table public.applications add constraint applications_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete cascade;
alter table public.applications add constraint applications_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete restrict;
alter table public.applications add constraint applications_id_org_unique unique(id,org_id);
alter table public.applications add constraint applications_final_decision_ck check(stage not in ('Hired','Rejected','Withdrawn') or (decision is not null and char_length(coalesce(decision_reason,''))>=3));
alter table public.score_runs add constraint score_runs_id_org_unique unique(id,org_id);
alter table public.score_runs add constraint score_runs_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete cascade;
alter table public.score_overrides add constraint score_overrides_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete cascade;
alter table public.notes add constraint notes_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete cascade;
alter table public.interview_scorecards add constraint scorecards_id_org_unique unique(id,org_id);
alter table public.interview_scorecards add constraint scorecards_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete cascade;
alter table public.interview_scorecard_answers add constraint answers_scorecard_org_fk foreign key(scorecard_id,org_id) references public.interview_scorecards(id,org_id) on delete cascade;
alter table public.privacy_requests add constraint privacy_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id);
alter table public.interview_questions add constraint questions_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete cascade;

create or replace function public.is_org_operator(check_org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select public.has_org_role(check_org,array['owner','admin','recruiter']::public.workspace_role[]) $$;
create or replace function public.can_review_job(check_org uuid,check_job uuid) returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.job_reviewer_assignments a join public.organization_members m on m.org_id=a.org_id and m.user_id=a.user_id where a.org_id=check_org and a.job_id=check_job and a.user_id=auth.uid() and m.role='reviewer') $$;
create or replace function public.can_review_candidate(check_org uuid,check_candidate uuid) returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.applications a join public.job_reviewer_assignments r on r.job_id=a.job_id and r.org_id=a.org_id join public.organization_members m on m.org_id=r.org_id and m.user_id=r.user_id where a.org_id=check_org and a.candidate_id=check_candidate and r.user_id=auth.uid() and m.role='reviewer') $$;
create or replace function public.can_review_application(check_org uuid,check_application uuid) returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.applications a join public.job_reviewer_assignments r on r.job_id=a.job_id and r.org_id=a.org_id join public.organization_members m on m.org_id=r.org_id and m.user_id=r.user_id where a.org_id=check_org and a.id=check_application and r.user_id=auth.uid() and m.role='reviewer') $$;
revoke all on function public.is_org_operator(uuid),public.can_review_job(uuid,uuid),public.can_review_candidate(uuid,uuid),public.can_review_application(uuid,uuid) from public;
grant execute on function public.is_org_operator(uuid),public.can_review_job(uuid,uuid),public.can_review_candidate(uuid,uuid),public.can_review_application(uuid,uuid) to authenticated;
create or replace function public.anonymize_candidate(p_org_id uuid,p_candidate_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.has_org_role(p_org_id,array['owner','admin']::public.workspace_role[]) then raise exception 'admin role required'; end if;
 delete from public.interview_scorecard_answers a using public.interview_scorecards s,public.applications p where a.scorecard_id=s.id and s.application_id=p.id and p.org_id=p_org_id and p.candidate_id=p_candidate_id;
 delete from public.interview_scorecards s using public.applications p where s.application_id=p.id and p.org_id=p_org_id and p.candidate_id=p_candidate_id;
 delete from public.notes n using public.applications p where n.application_id=p.id and p.org_id=p_org_id and p.candidate_id=p_candidate_id;
 delete from public.score_overrides o using public.applications p where o.application_id=p.id and p.org_id=p_org_id and p.candidate_id=p_candidate_id;
 update public.score_runs r set total_score=null,evidence_coverage=0,result='{"redacted":true,"reason":"privacy_request"}'::jsonb,criteria_snapshot='[]'::jsonb
 from public.applications p where r.application_id=p.id and p.org_id=p_org_id and p.candidate_id=p_candidate_id;
 delete from public.candidate_experiences where org_id=p_org_id and candidate_id=p_candidate_id;
 delete from public.candidate_educations where org_id=p_org_id and candidate_id=p_candidate_id;
 delete from public.candidate_skills where org_id=p_org_id and candidate_id=p_candidate_id;
 delete from public.resume_assets where org_id=p_org_id and candidate_id=p_candidate_id;
 update public.candidates set full_name=null,email=null,normalized_email=null,phone=null,current_title=null,current_employer=null,
 skills='[]'::jsonb,source=null,consent_status='withdrawn',parsing_warnings='[]'::jsonb,parse_status='deleted',deleted_at=now()
 where id=p_candidate_id and org_id=p_org_id;
end $$;
revoke all on function public.anonymize_candidate(uuid,uuid) from public;
grant execute on function public.anonymize_candidate(uuid,uuid) to authenticated;
create or replace function public.cleanup_empty_candidate(p_org_id uuid,p_candidate_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.has_org_role(p_org_id,array['owner','admin','recruiter']::public.workspace_role[]) then raise exception 'writer role required'; end if;
 if not exists(select 1 from public.resume_assets where org_id=p_org_id and candidate_id=p_candidate_id)
    and not exists(select 1 from public.applications where org_id=p_org_id and candidate_id=p_candidate_id) then
   delete from public.candidates where id=p_candidate_id and org_id=p_org_id;
 end if;
end $$;
revoke all on function public.cleanup_empty_candidate(uuid,uuid) from public;
grant execute on function public.cleanup_empty_candidate(uuid,uuid) to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 new.updated_at=now();
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['organizations','clients','jobs','job_requirements','candidates','applications','privacy_requests'] loop
  execute format('create trigger %I_touch_updated before update on public.%I for each row execute function public.touch_updated_at()',t,t);
 end loop;
end $$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
create policy organizations_select_member on public.organizations for select to authenticated using(public.is_org_member(id));
create policy organizations_update_admin on public.organizations for update to authenticated using(public.has_org_role(id,array['owner','admin']::public.workspace_role[])) with check(public.has_org_role(id,array['owner','admin']::public.workspace_role[]));
create policy members_select_self_or_member on public.organization_members for select to authenticated using(user_id=auth.uid() or public.is_org_member(org_id));
create policy members_insert_admin on public.organization_members for insert to authenticated with check(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]) and role<>'owner');
create policy members_update_admin on public.organization_members for update to authenticated using(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]) and role<>'owner') with check(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]) and role<>'owner');
create policy members_delete_admin on public.organization_members for delete to authenticated using(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]) and role<>'owner' and user_id<>auth.uid());
alter table public.job_reviewer_assignments enable row level security;
create policy reviewer_assignments_read on public.job_reviewer_assignments for select to authenticated using(public.is_org_operator(org_id) or user_id=auth.uid());
create policy reviewer_assignments_insert_admin on public.job_reviewer_assignments for insert to authenticated with check(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]));
create policy reviewer_assignments_delete_admin on public.job_reviewer_assignments for delete to authenticated using(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]));

do $$ declare t text; read_rule text; begin
 foreach t in array array['clients','jobs','job_requirements','candidates','resume_assets','candidate_experiences','candidate_educations','candidate_skills','applications','score_runs','score_overrides','notes','activity_events','audit_logs','interview_scorecards','interview_scorecard_answers','interview_questions','privacy_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  if t='privacy_requests' then read_rule := 'public.has_org_role(org_id,array[''owner'',''admin'']::public.workspace_role[])';
  elsif t='clients' or t='score_overrides' or t='activity_events' or t='audit_logs' then read_rule := 'public.is_org_operator(org_id)';
  elsif t='jobs' then read_rule := 'public.is_org_operator(org_id) or public.can_review_job(org_id,id)';
  elsif t='job_requirements' or t='interview_questions' then read_rule := 'public.is_org_operator(org_id) or public.can_review_job(org_id,job_id)';
  elsif t='candidates' or t='resume_assets' or t='candidate_experiences' or t='candidate_educations' or t='candidate_skills' then read_rule := 'public.is_org_operator(org_id) or public.can_review_candidate(org_id,candidate_id)';
  elsif t='applications' then read_rule := 'public.is_org_operator(org_id) or public.can_review_job(org_id,job_id)';
  elsif t='score_runs' or t='notes' or t='interview_scorecards' then read_rule := 'public.is_org_operator(org_id) or public.can_review_application(org_id,application_id)';
  elsif t='interview_scorecard_answers' then read_rule := 'public.is_org_operator(org_id) or exists(select 1 from public.interview_scorecards c where c.id=scorecard_id and public.can_review_application(org_id,c.application_id) and (not c.blinded or c.reviewer_id=auth.uid() or exists(select 1 from public.interview_scorecards own where own.application_id=c.application_id and own.reviewer_id=auth.uid() and own.submitted_at is not null)))';
  else read_rule := 'public.is_org_operator(org_id)'; end if;
  execute format('create policy %I_read_member on public.%I for select to authenticated using(%s)',t,t,read_rule);
  execute format('create policy %I_insert_writer on public.%I for insert to authenticated with check(public.has_org_role(org_id,array[''owner'',''admin'',''recruiter'']::public.workspace_role[]))',t,t);
  execute format('create policy %I_update_writer on public.%I for update to authenticated using(public.has_org_role(org_id,array[''owner'',''admin'',''recruiter'']::public.workspace_role[])) with check(public.has_org_role(org_id,array[''owner'',''admin'',''recruiter'']::public.workspace_role[]))',t,t);
  execute format('create policy %I_delete_admin on public.%I for delete to authenticated using(public.has_org_role(org_id,array[''owner'',''admin'']::public.workspace_role[]))',t,t);
 end loop;
end $$;
drop policy interview_questions_read_member on public.interview_questions;
create policy interview_questions_read_assigned on public.interview_questions for select to authenticated
 using(public.is_org_operator(org_id) or public.can_review_job(org_id,job_id));
drop policy interview_questions_delete_admin on public.interview_questions;
create policy interview_questions_delete_writer on public.interview_questions for delete to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruiter']::public.workspace_role[]));
-- Keep score and activity history append-only. Audit rows are written by a safe trigger.
drop policy activity_events_update_writer on public.activity_events;
drop policy activity_events_delete_admin on public.activity_events;
drop policy audit_logs_insert_writer on public.audit_logs;
drop policy audit_logs_update_writer on public.audit_logs;
drop policy audit_logs_delete_admin on public.audit_logs;
drop policy score_runs_update_writer on public.score_runs;
drop policy score_runs_delete_admin on public.score_runs;
drop policy score_overrides_update_writer on public.score_overrides;
drop policy score_overrides_delete_admin on public.score_overrides;
create or replace function public.copy_activity_to_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.audit_logs(org_id,actor_id,entity_type,entity_id,action,safe_metadata)
 values(new.org_id,new.actor_id,new.entity_type,new.entity_id,new.action,coalesce(new.metadata,'{}'::jsonb));
 return new;
end $$;
revoke all on function public.copy_activity_to_audit() from public;
create trigger activity_to_audit after insert on public.activity_events for each row execute function public.copy_activity_to_audit();
create policy scorecards_insert_reviewer on public.interview_scorecards for insert to authenticated with check(public.has_org_role(org_id,array['owner','admin','recruiter','reviewer']::public.workspace_role[]) and reviewer_id=auth.uid());
create policy scorecard_answers_insert_reviewer on public.interview_scorecard_answers for insert to authenticated with check(public.has_org_role(org_id,array['owner','admin','recruiter','reviewer']::public.workspace_role[]));

create or replace function public.storage_org_member(object_name text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if split_part(object_name,'/',1)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 return public.is_org_member(split_part(object_name,'/',1)::uuid);
end $$;
create or replace function public.storage_resume_read(object_name text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare org_text text := split_part(object_name,'/',1); candidate_text text := split_part(object_name,'/',2); org_uuid uuid; candidate_uuid uuid;
begin
 if org_text!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or candidate_text!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 org_uuid := org_text::uuid; candidate_uuid := candidate_text::uuid;
 return public.is_org_operator(org_uuid) or public.can_review_candidate(org_uuid,candidate_uuid);
end $$;
revoke all on function public.storage_org_member(text),public.storage_resume_read(text) from public;
grant execute on function public.storage_org_member(text),public.storage_resume_read(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('candidate-resumes','candidate-resumes',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy resumes_read_assigned on storage.objects for select to authenticated using(bucket_id='candidate-resumes' and public.storage_resume_read(name));
create policy resumes_insert_writer on storage.objects for insert to authenticated with check(bucket_id='candidate-resumes' and public.storage_org_member(name) and public.has_org_role(split_part(name,'/',1)::uuid,array['owner','admin','recruiter']::public.workspace_role[]));
create policy resumes_delete_writer on storage.objects for delete to authenticated using(bucket_id='candidate-resumes' and public.storage_org_member(name) and (public.has_org_role(split_part(name,'/',1)::uuid,array['owner','admin']::public.workspace_role[]) or (public.has_org_role(split_part(name,'/',1)::uuid,array['recruiter']::public.workspace_role[]) and split_part(name,'/',3)=auth.uid()::text)));
grant select,insert,update,delete on all tables in schema public to authenticated;
