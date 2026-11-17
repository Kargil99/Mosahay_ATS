-- Client reviewers use a least-privilege portal that exposes only approved submission snapshots.
-- Recruiters keep access to the complete candidate profile through the internal workspace.
drop policy candidates_read_member on public.candidates;
create policy candidates_read_internal on public.candidates for select to authenticated
  using (public.is_org_operator(org_id));

drop policy candidate_experiences_read_member on public.candidate_experiences;
create policy candidate_experiences_read_internal on public.candidate_experiences for select to authenticated
  using (public.is_org_operator(org_id));

drop policy candidate_educations_read_member on public.candidate_educations;
create policy candidate_educations_read_internal on public.candidate_educations for select to authenticated
  using (public.is_org_operator(org_id));

drop policy candidate_skills_read_member on public.candidate_skills;
create policy candidate_skills_read_internal on public.candidate_skills for select to authenticated
  using (public.is_org_operator(org_id));

drop policy notes_read_member on public.notes;
create policy notes_read_internal on public.notes for select to authenticated
  using (public.is_org_operator(org_id));

drop policy score_runs_read_member on public.score_runs;
create policy score_runs_read_internal on public.score_runs for select to authenticated
  using (public.is_org_operator(org_id));

drop policy interview_scorecards_read_member on public.interview_scorecards;
create policy interview_scorecards_read_internal on public.interview_scorecards for select to authenticated
  using (public.is_org_operator(org_id) or reviewer_id=auth.uid());

drop policy interview_scorecard_answers_read_member on public.interview_scorecard_answers;
create policy interview_scorecard_answers_read_internal on public.interview_scorecard_answers for select to authenticated
  using (public.is_org_operator(org_id) or exists(
    select 1 from public.interview_scorecards card
    where card.id=scorecard_id and card.org_id=public.interview_scorecard_answers.org_id and card.reviewer_id=auth.uid()
  ));

drop policy resume_assets_read_member on public.resume_assets;
create policy resume_assets_read_internal on public.resume_assets for select to authenticated
  using (public.is_org_operator(org_id));

drop policy job_posters_read_member on public.job_posters;
create policy job_posters_read_internal on public.job_posters for select to authenticated
  using (public.is_org_operator(org_id));

drop policy resumes_read_assigned on storage.objects;
create or replace function public.storage_resume_read_internal(object_name text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare org_text text := split_part(object_name,'/',1);
begin
  if org_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.is_org_operator(org_text::uuid);
end $$;
revoke all on function public.storage_resume_read_internal(text) from public;
grant execute on function public.storage_resume_read_internal(text) to authenticated;
create policy resumes_read_internal on storage.objects for select to authenticated
  using (bucket_id='candidate-resumes' and public.storage_resume_read_internal(name));

create policy submissions_read_assigned_reviewer on public.candidate_submissions for select to authenticated
  using (public.has_org_role(org_id,array['reviewer']::public.workspace_role[])
    and public.can_review_application(org_id,application_id)
    and status <> 'withdrawn');

drop policy members_select_self_or_member on public.organization_members;
create policy members_select_internal_or_self on public.organization_members for select to authenticated
  using (user_id=auth.uid() or public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer','finance']::public.workspace_role[]));

-- Workspace members need only the public workspace identity through direct table access.
-- Confidential workspace settings are returned by a role-aware RPC for internal users.
revoke select on public.organizations from authenticated;
grant select (id,name,created_at) on public.organizations to authenticated;
create or replace function public.get_workspace_settings(p_org_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  member_role public.workspace_role;
  setting_row jsonb;
begin
  select role into member_role from public.organization_members where org_id=p_org_id and user_id=auth.uid();
  if member_role is null then raise exception 'workspace access required'; end if;
  if member_role in ('reviewer','finance') then
    select jsonb_build_object('id',id,'name',name,'created_at',created_at,'role',member_role)
      into setting_row from public.organizations where id=p_org_id;
    return setting_row;
  end if;
  select to_jsonb(o) || jsonb_build_object('role',member_role)
    into setting_row from public.organizations o where o.id=p_org_id;
  return setting_row;
end $$;
revoke all on function public.get_workspace_settings(uuid) from public;
grant execute on function public.get_workspace_settings(uuid) to authenticated;

-- The function only changes review fields and records a safe audit event. Reviewers cannot
-- directly update submission rows or candidate records through PostgREST.
create or replace function public.review_candidate_submission(
  p_submission_id uuid,
  p_status text,
  p_feedback text default ''
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  submission_row public.candidate_submissions%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_status is null or p_status not in ('accepted','rejected','interview_requested','more_information_requested') then
    raise exception 'invalid review status';
  end if;
  if length(coalesce(p_feedback,'')) > 5000 then raise exception 'feedback is too long'; end if;

  select * into submission_row
    from public.candidate_submissions
    where id=p_submission_id
    for update;
  if not found then raise exception 'submission not found'; end if;
  if not public.has_org_role(submission_row.org_id,array['reviewer']::public.workspace_role[])
     or not public.can_review_application(submission_row.org_id,submission_row.application_id) then
    raise exception 'forbidden';
  end if;
  if submission_row.status in ('withdrawn','accepted','rejected') then
    raise exception 'submission is already finalized';
  end if;

  update public.candidate_submissions
    set status=p_status,
        feedback=nullif(trim(coalesce(p_feedback,'')),''),
        reviewed_by=auth.uid(),
        reviewed_at=now(),
        updated_at=now()
    where id=p_submission_id;
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(submission_row.org_id,auth.uid(),'candidate_submission',p_submission_id,
      'client_submission_reviewed',jsonb_build_object('status',p_status,'client_id',submission_row.client_id));
  return p_submission_id;
end $$;
revoke all on function public.review_candidate_submission(uuid,text,text) from public;
grant execute on function public.review_candidate_submission(uuid,text,text) to authenticated;

-- Freeze a contact-free fit summary into the submission snapshot. Never expose resume quotes.
create or replace function public.submit_application_to_client(p_application_id uuid) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  application_row public.applications%rowtype;
  job_row public.jobs%rowtype;
  candidate_row public.candidates%rowtype;
  score_result jsonb;
  fit_summary jsonb;
  criteria_summary jsonb;
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

  select result into score_result from public.score_runs
    where application_id=p_application_id order by created_at desc limit 1;
  if score_result is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'criterion',item->>'criterion',
      'weight',item->'weight',
      'state',item->>'state',
      'explanation',item->>'explanation'
    ) order by ordinal),'[]'::jsonb)
    into criteria_summary
    from jsonb_array_elements(coalesce(score_result->'criteria','[]'::jsonb)) with ordinality as parsed(item,ordinal);
    fit_summary := jsonb_build_object(
      'match_score',score_result->'match_score',
      'evidence_coverage',score_result->'evidence_coverage',
      'confidence',score_result->'confidence',
      'criteria',coalesce(criteria_summary,'[]'::jsonb),
      'notice','Advisory evidence summary. Not a hiring decision.'
    );
  else
    fit_summary := null;
  end if;

  select coalesce(max(submission_number),0)+1 into next_number from public.candidate_submissions where application_id=p_application_id and client_id=job_row.client_id;
  insert into public.candidate_submissions(org_id,application_id,client_id,submission_number,status,shared_profile,submitted_by)
    values(application_row.org_id,p_application_id,job_row.client_id,next_number,'submitted',
      jsonb_strip_nulls(jsonb_build_object(
        'candidate_name',candidate_row.full_name,
        'current_title',candidate_row.current_title,
        'current_employer',candidate_row.current_employer,
        'skills',candidate_row.skills,
        'job_title',job_row.title,
        'candidate_reference',left(application_row.id::text,8),
        'fit_summary',fit_summary
      )),auth.uid())
    returning id into submission_id;
  update public.applications set stage='Submitted to Client',stage_changed_at=now(),updated_at=now() where id=p_application_id;
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(application_row.org_id,auth.uid(),'application',p_application_id,'candidate_submitted_to_client',jsonb_build_object('submission_id',submission_id,'client_id',job_row.client_id,'submission_number',next_number));
  return submission_id;
end $$;
revoke all on function public.submit_application_to_client(uuid) from public;
grant execute on function public.submit_application_to_client(uuid) to authenticated;
