-- Recruitment operations, client submissions, interviews, task management, and placements.
create table public.recruiter_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check(char_length(title) between 2 and 180),
  description text not null default '' check(char_length(description) <= 5000),
  assigned_to uuid references auth.users(id) on delete set null,
  candidate_id uuid,
  job_id uuid,
  client_id uuid,
  application_id uuid,
  due_at timestamptz,
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete set null (candidate_id),
  constraint task_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete set null (job_id),
  constraint task_client_org_fk foreign key(client_id,org_id) references public.clients(id,org_id) on delete set null (client_id),
  constraint task_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete set null (application_id)
);
create index recruiter_tasks_due_idx on public.recruiter_tasks(org_id,status,due_at);
create index recruiter_tasks_assignee_idx on public.recruiter_tasks(org_id,assigned_to,status,due_at);

create table public.candidate_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  application_id uuid not null,
  client_id uuid not null,
  submission_number integer not null default 1,
  status text not null default 'submitted' check(status in ('submitted','viewed','accepted','rejected','interview_requested','more_information_requested','withdrawn')),
  shared_profile jsonb not null default '{}'::jsonb,
  submitted_by uuid references auth.users(id) on delete set null,
  feedback text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submission_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete cascade,
  constraint submission_client_org_fk foreign key(client_id,org_id) references public.clients(id,org_id) on delete cascade,
  unique(application_id,client_id,submission_number)
);
create index candidate_submissions_client_idx on public.candidate_submissions(org_id,client_id,status,created_at desc);
create index candidate_submissions_app_idx on public.candidate_submissions(application_id,created_at desc);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  application_id uuid not null,
  candidate_id uuid not null,
  job_id uuid not null,
  client_id uuid,
  scheduled_by uuid references auth.users(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60 check(duration_minutes between 15 and 480),
  mode text not null check(mode in ('onsite','video','phone')),
  location text,
  meeting_link text,
  status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled','no_show')),
  feedback_summary text,
  reminder_status text not null default 'not_configured' check(reminder_status in ('not_configured','pending','sent','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete cascade,
  constraint interview_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete cascade,
  constraint interview_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete cascade,
  constraint interview_client_org_fk foreign key(client_id,org_id) references public.clients(id,org_id) on delete set null (client_id)
);
create index interviews_schedule_idx on public.interviews(org_id,scheduled_at,status);
create index interviews_candidate_idx on public.interviews(candidate_id,scheduled_at desc);

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  application_id uuid not null unique,
  candidate_id uuid not null,
  job_id uuid not null,
  client_id uuid not null,
  recruiter_id uuid references auth.users(id) on delete set null,
  joining_date date not null,
  designation text not null check(char_length(designation) between 2 and 180),
  agreed_ctc numeric(14,2) check(agreed_ctc is null or agreed_ctc >= 0),
  fee_model text not null check(fee_model in ('fixed','percentage','milestone','custom')),
  fee_value numeric(14,2) not null check(fee_value >= 0),
  expected_fee numeric(14,2) not null check(expected_fee >= 0),
  invoice_status text not null default 'not_invoiced' check(invoice_status in ('not_invoiced','draft','issued','paid','overdue')),
  payment_status text not null default 'pending' check(payment_status in ('pending','partial','paid','overdue')),
  guarantee_months integer not null default 0 check(guarantee_months between 0 and 36),
  replacement_deadline date,
  status text not null default 'active' check(status in ('active','replacement_due','replaced','completed')),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint placement_application_org_fk foreign key(application_id,org_id) references public.applications(id,org_id) on delete restrict,
  constraint placement_candidate_org_fk foreign key(candidate_id,org_id) references public.candidates(id,org_id) on delete restrict,
  constraint placement_job_org_fk foreign key(job_id,org_id) references public.jobs(id,org_id) on delete restrict,
  constraint placement_client_org_fk foreign key(client_id,org_id) references public.clients(id,org_id) on delete restrict
);
create index placements_org_date_idx on public.placements(org_id,joining_date desc);
create index placements_finance_idx on public.placements(org_id,payment_status,invoice_status);
create table public.replacement_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  placement_id uuid not null references public.placements(id) on delete cascade,
  status text not null default 'open' check(status in ('open','in_progress','filled','closed')),
  reason text not null check(char_length(reason) between 3 and 2000),
  replacement_candidate_id uuid,
  due_date date,
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint replacement_candidate_org_fk foreign key(replacement_candidate_id,org_id) references public.candidates(id,org_id) on delete set null (replacement_candidate_id)
);

alter table public.recruiter_tasks enable row level security;
alter table public.candidate_submissions enable row level security;
alter table public.interviews enable row level security;
alter table public.placements enable row level security;
alter table public.replacement_records enable row level security;

create policy recruiter_tasks_read_internal on public.recruiter_tasks for select to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer','finance']::public.workspace_role[])
   and (public.has_org_role(org_id,array['owner','admin','recruitment_manager','finance']::public.workspace_role[]) or assigned_to=auth.uid()));
create policy recruiter_tasks_insert_internal on public.recruiter_tasks for insert to authenticated
 with check(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer']::public.workspace_role[]) and created_by=auth.uid());
create policy recruiter_tasks_update_internal on public.recruiter_tasks for update to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer']::public.workspace_role[])
   and (public.has_org_role(org_id,array['owner','admin','recruitment_manager']::public.workspace_role[]) or assigned_to=auth.uid()))
 with check(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer']::public.workspace_role[]));
create policy recruiter_tasks_delete_admin on public.recruiter_tasks for delete to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager']::public.workspace_role[]));

create policy submissions_read_internal on public.candidate_submissions for select to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','finance']::public.workspace_role[]));
create policy submissions_insert_internal on public.candidate_submissions for insert to authenticated
 with check(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]) and submitted_by=auth.uid());
create policy submissions_update_internal on public.candidate_submissions for update to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]))
 with check(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));
create policy submissions_delete_admin on public.candidate_submissions for delete to authenticated
 using(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]));

create policy interviews_read_internal on public.interviews for select to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','reviewer']::public.workspace_role[])
   and (public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]) or public.can_review_application(org_id,application_id)));
create policy interviews_insert_internal on public.interviews for insert to authenticated
 with check(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]) and scheduled_by=auth.uid());
create policy interviews_update_internal on public.interviews for update to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]))
 with check(public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));
create policy interviews_delete_admin on public.interviews for delete to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager']::public.workspace_role[]));

create policy placements_read_finance on public.placements for select to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','finance']::public.workspace_role[])
   or (public.has_org_role(org_id,array['recruiter']::public.workspace_role[]) and recruiter_id=auth.uid()));
create policy placements_insert_finance on public.placements for insert to authenticated
 with check(public.has_org_role(org_id,array['owner','admin','finance']::public.workspace_role[]) and created_by=auth.uid());
create policy placements_update_finance on public.placements for update to authenticated
 using(public.has_org_role(org_id,array['owner','admin','finance']::public.workspace_role[]))
 with check(public.has_org_role(org_id,array['owner','admin','finance']::public.workspace_role[]));
create policy placements_delete_admin on public.placements for delete to authenticated
 using(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]));

create policy replacements_read_finance on public.replacement_records for select to authenticated
 using(public.has_org_role(org_id,array['owner','admin','recruitment_manager','finance']::public.workspace_role[]));
create policy replacements_insert_finance on public.replacement_records for insert to authenticated
 with check(public.has_org_role(org_id,array['owner','admin','finance']::public.workspace_role[]));
create policy replacements_update_finance on public.replacement_records for update to authenticated
 using(public.has_org_role(org_id,array['owner','admin','finance']::public.workspace_role[]))
 with check(public.has_org_role(org_id,array['owner','admin','finance']::public.workspace_role[]));
create policy replacements_delete_admin on public.replacement_records for delete to authenticated
 using(public.has_org_role(org_id,array['owner','admin']::public.workspace_role[]));

-- Candidate sharing is a single transaction. Share only approved profile fields; omit phone/email.
create or replace function public.submit_application_to_client(p_application_id uuid) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  application_row public.applications%rowtype;
  job_row public.jobs%rowtype;
  candidate_row public.candidates%rowtype;
  next_number integer;
  submission_id uuid;
begin
  select * into application_row from public.applications where id=p_application_id for update;
  if not found then raise exception 'application not found'; end if;
  if not public.has_org_role(application_row.org_id,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]) then raise exception 'forbidden'; end if;
  select * into job_row from public.jobs where id=application_row.job_id;
  select * into candidate_row from public.candidates where id=application_row.candidate_id;
  if job_row.client_id is null then raise exception 'job has no client'; end if;
  if candidate_row.consent_status not in ('recorded','not_required') then raise exception 'candidate sharing notice has not been recorded'; end if;
  select coalesce(max(submission_number),0)+1 into next_number from public.candidate_submissions where application_id=p_application_id and client_id=job_row.client_id;
  insert into public.candidate_submissions(org_id,application_id,client_id,submission_number,status,shared_profile,submitted_by)
    values(application_row.org_id,p_application_id,job_row.client_id,next_number,'submitted',
      jsonb_build_object('candidate_name',candidate_row.full_name,'current_title',candidate_row.current_title,'current_employer',candidate_row.current_employer,'skills',candidate_row.skills,'job_title',job_row.title,'candidate_reference',left(application_row.id::text,8)),auth.uid())
    returning id into submission_id;
  update public.applications set stage='Submitted to Client',stage_changed_at=now(),updated_at=now() where id=p_application_id;
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(application_row.org_id,auth.uid(),'application',p_application_id,'candidate_submitted_to_client',jsonb_build_object('submission_id',submission_id,'client_id',job_row.client_id,'submission_number',next_number));
  return submission_id;
end $$;
revoke all on function public.submit_application_to_client(uuid) from public;
grant execute on function public.submit_application_to_client(uuid) to authenticated;

-- Recruitment managers have operational access; finance users see records required for placements only.
create or replace function public.is_org_operator(check_org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select public.has_org_role(check_org,array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]) $$;

do $$ declare t text; begin
 foreach t in array array['clients','jobs','job_requirements','candidates','resume_assets','candidate_experiences','candidate_educations','candidate_skills','applications','notes','interview_questions'] loop
  execute format('create policy %I_manager_insert on public.%I for insert to authenticated with check(public.has_org_role(org_id,array[''recruitment_manager'']::public.workspace_role[]))',t,t);
  execute format('create policy %I_manager_update on public.%I for update to authenticated using(public.has_org_role(org_id,array[''recruitment_manager'']::public.workspace_role[])) with check(public.has_org_role(org_id,array[''recruitment_manager'']::public.workspace_role[]))',t,t);
 end loop;
end $$;

create policy applications_finance_hired_read on public.applications for select to authenticated
 using(public.has_org_role(org_id,array['finance']::public.workspace_role[]) and decision='hired');
create policy candidates_finance_hired_read on public.candidates for select to authenticated
 using(public.has_org_role(org_id,array['finance']::public.workspace_role[]) and exists(select 1 from public.applications a where a.org_id=candidates.org_id and a.candidate_id=candidates.id and a.decision='hired'));
create policy jobs_finance_hired_read on public.jobs for select to authenticated
 using(public.has_org_role(org_id,array['finance']::public.workspace_role[]) and exists(select 1 from public.applications a where a.org_id=jobs.org_id and a.job_id=jobs.id and a.decision='hired'));
create policy clients_finance_hired_read on public.clients for select to authenticated
 using(public.has_org_role(org_id,array['finance']::public.workspace_role[]) and exists(select 1 from public.jobs j join public.applications a on a.job_id=j.id and a.org_id=j.org_id where j.org_id=clients.org_id and j.client_id=clients.id and a.decision='hired'));
