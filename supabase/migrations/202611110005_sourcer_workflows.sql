-- Give sourcers the candidate intake and follow-up access defined by the product roles.
create policy clients_read_sourcer on public.clients for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy jobs_read_sourcer on public.jobs for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy requirements_read_sourcer on public.job_requirements for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy candidates_read_sourcer on public.candidates for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy resume_assets_read_sourcer on public.resume_assets for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy experiences_read_sourcer on public.candidate_experiences for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy educations_read_sourcer on public.candidate_educations for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy skills_read_sourcer on public.candidate_skills for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy applications_read_sourcer on public.applications for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy notes_read_sourcer on public.notes for select to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));

create policy candidates_insert_sourcer on public.candidates for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy candidates_update_sourcer on public.candidates for update to authenticated
  using (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]))
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy resume_assets_insert_sourcer on public.resume_assets for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy experiences_insert_sourcer on public.candidate_experiences for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy educations_insert_sourcer on public.candidate_educations for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy skills_insert_sourcer on public.candidate_skills for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy applications_insert_sourcer on public.applications for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]));
create policy notes_insert_sourcer on public.notes for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]) and author_id=auth.uid());
create policy activity_events_insert_sourcer on public.activity_events for insert to authenticated
  with check (public.has_org_role(org_id,array['sourcer']::public.workspace_role[]) and actor_id=auth.uid());
create policy resumes_insert_sourcer on storage.objects for insert to authenticated
  with check (bucket_id='candidate-resumes'
    and public.storage_org_member(name)
    and public.has_org_role(split_part(name,'/',1)::uuid,array['sourcer']::public.workspace_role[])
    and split_part(name,'/',3)=auth.uid()::text);

create policy job_posters_insert_manager on public.job_posters for insert to authenticated
  with check (public.has_org_role(org_id,array['recruitment_manager']::public.workspace_role[]) and created_by=auth.uid());
create policy job_posters_update_manager on public.job_posters for update to authenticated
  using (public.has_org_role(org_id,array['recruitment_manager']::public.workspace_role[]))
  with check (public.has_org_role(org_id,array['recruitment_manager']::public.workspace_role[]));

create policy scorecards_insert_manager on public.interview_scorecards for insert to authenticated
  with check (public.has_org_role(org_id,array['recruitment_manager']::public.workspace_role[]) and reviewer_id=auth.uid());
create policy scorecard_answers_insert_manager on public.interview_scorecard_answers for insert to authenticated
  with check (public.has_org_role(org_id,array['recruitment_manager']::public.workspace_role[]));

create or replace function public.cleanup_empty_candidate(p_org_id uuid,p_candidate_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.has_org_role(p_org_id,array['owner','admin','recruiter','sourcer']::public.workspace_role[]) then
    raise exception 'writer role required';
  end if;
  if not exists(select 1 from public.resume_assets where org_id=p_org_id and candidate_id=p_candidate_id)
     and not exists(select 1 from public.applications where org_id=p_org_id and candidate_id=p_candidate_id) then
    delete from public.candidates where id=p_candidate_id and org_id=p_org_id;
  end if;
end $$;
revoke all on function public.cleanup_empty_candidate(uuid,uuid) from public;
grant execute on function public.cleanup_empty_candidate(uuid,uuid) to authenticated;

create or replace function public.storage_resume_read_internal(object_name text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare org_text text := split_part(object_name,'/',1);
begin
  if org_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.has_org_role(org_text::uuid,array['owner','admin','recruitment_manager','recruiter','sourcer']::public.workspace_role[]);
end $$;
revoke all on function public.storage_resume_read_internal(text) from public;
grant execute on function public.storage_resume_read_internal(text) to authenticated;

drop policy recruiter_tasks_read_internal on public.recruiter_tasks;
create policy recruiter_tasks_read_internal on public.recruiter_tasks for select to authenticated
  using (public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer','finance']::public.workspace_role[])
    and (public.has_org_role(org_id,array['owner','admin','recruitment_manager','finance']::public.workspace_role[])
      or assigned_to=auth.uid() or created_by=auth.uid()));
drop policy recruiter_tasks_update_internal on public.recruiter_tasks;
create policy recruiter_tasks_update_internal on public.recruiter_tasks for update to authenticated
  using (public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer']::public.workspace_role[])
    and (public.has_org_role(org_id,array['owner','admin','recruitment_manager']::public.workspace_role[])
      or assigned_to=auth.uid() or created_by=auth.uid()))
  with check (public.has_org_role(org_id,array['owner','admin','recruitment_manager','recruiter','sourcer']::public.workspace_role[]));

create or replace function public.assign_application_owner(p_application_id uuid,p_assigned_to uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare application_row public.applications%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into application_row from public.applications where id=p_application_id for update;
  if not found then raise exception 'application not found'; end if;
  if not public.has_org_role(application_row.org_id,array['owner','admin','recruitment_manager','recruiter','sourcer']::public.workspace_role[]) then
    raise exception 'forbidden';
  end if;
  if not exists(select 1 from public.organization_members
    where org_id=application_row.org_id and user_id=p_assigned_to and role='recruiter') then
    raise exception 'assignee must be a recruiter in this workspace';
  end if;
  update public.applications set owner_id=p_assigned_to,updated_at=now() where id=p_application_id;
  insert into public.activity_events(org_id,actor_id,entity_type,entity_id,action,metadata)
    values(application_row.org_id,auth.uid(),'application',p_application_id,'application_assigned',jsonb_build_object('assigned_to',p_assigned_to));
  return p_application_id;
end $$;
revoke all on function public.assign_application_owner(uuid,uuid) from public;
grant execute on function public.assign_application_owner(uuid,uuid) to authenticated;
