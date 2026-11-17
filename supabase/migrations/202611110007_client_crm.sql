-- Structured client CRM records. Contract terms are kept separate from day-to-day
-- contacts and are restricted to managers and finance users by RLS.
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 180),
  title text,
  email text,
  phone text,
  office_id uuid,
  is_primary boolean not null default false,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_contacts_client_fk foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete cascade
);
create index client_contacts_client_idx on public.client_contacts(org_id, client_id, created_at desc);
create unique index client_contacts_one_primary_idx on public.client_contacts(client_id) where is_primary and archived_at is null;

create table public.client_offices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  address text,
  city text,
  state text,
  country text not null default 'India',
  postal_code text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_offices_client_fk foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete cascade,
  constraint client_offices_composite_unique unique (id, client_id, org_id)
);
create index client_offices_client_idx on public.client_offices(org_id, client_id, created_at desc);
alter table public.client_contacts add constraint client_contacts_office_same_account_fk
  foreign key (office_id, client_id, org_id) references public.client_offices(id, client_id, org_id);

create table public.client_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  title text not null check (char_length(trim(title)) between 2 and 180),
  contract_number text,
  status text not null default 'draft' check (status in ('draft','active','expired','terminated')),
  fee_model text not null check (fee_model in ('fixed','percentage','milestone','custom')),
  fee_value numeric(14,2) not null check (fee_value >= 0),
  currency char(3) not null default 'INR',
  valid_from date,
  valid_until date,
  guarantee_months integer not null default 0 check (guarantee_months between 0 and 36),
  payment_terms text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_contracts_client_fk foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete cascade,
  constraint client_contracts_validity_check check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index client_contracts_client_idx on public.client_contracts(org_id, client_id, created_at desc);

create table public.client_activity_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  activity_type text not null check (activity_type in ('note','call','email','meeting','system')),
  subject text not null check (char_length(trim(subject)) between 1 and 180),
  details text,
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint client_activity_client_fk foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete cascade
);
create index client_activity_client_idx on public.client_activity_logs(org_id, client_id, happened_at desc);

alter table public.client_contacts enable row level security;
create policy client_contacts_read on public.client_contacts for select to authenticated
  using (public.is_org_operator(org_id));
create policy client_contacts_insert on public.client_contacts for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));
create policy client_contacts_update on public.client_contacts for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]))
  with check (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));
create policy client_contacts_delete on public.client_contacts for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));

alter table public.client_offices enable row level security;
create policy client_offices_read on public.client_offices for select to authenticated
  using (public.is_org_operator(org_id));
create policy client_offices_insert on public.client_offices for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));
create policy client_offices_update on public.client_offices for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]))
  with check (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));
create policy client_offices_delete on public.client_offices for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));

alter table public.client_contracts enable row level security;
create policy client_contracts_read on public.client_contracts for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin','recruitment_manager','finance']::public.workspace_role[]));
create policy client_contracts_insert on public.client_contracts for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin','recruitment_manager']::public.workspace_role[]));
create policy client_contracts_update on public.client_contracts for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin','recruitment_manager']::public.workspace_role[]))
  with check (public.has_org_role(org_id, array['owner','admin','recruitment_manager']::public.workspace_role[]));
create policy client_contracts_delete on public.client_contracts for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.workspace_role[]));

alter table public.client_activity_logs enable row level security;
create policy client_activity_logs_read on public.client_activity_logs for select to authenticated
  using (public.is_org_operator(org_id));
create policy client_activity_logs_insert on public.client_activity_logs for insert to authenticated
  with check (actor_id = auth.uid() and public.has_org_role(org_id, array['owner','admin','recruitment_manager','recruiter']::public.workspace_role[]));
-- A timeline is append-only: callers cannot revise or erase recorded history.

create or replace function public.log_client_crm_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  target_org uuid;
  target_client uuid;
  row_label text;
  verb text;
begin
  target_org := new.org_id;
  target_client := new.client_id;
  if tg_op = 'INSERT' then verb := 'added';
  elsif tg_op = 'UPDATE' then verb := 'updated';
  else verb := 'archived'; end if;
  if tg_table_name = 'client_contacts' then row_label := 'Contact';
  elsif tg_table_name = 'client_offices' then row_label := 'Office';
  else row_label := 'Contract'; end if;
  insert into public.client_activity_logs(org_id, client_id, actor_id, activity_type, subject, details)
  values (target_org, target_client, auth.uid(), 'system', row_label || ' ' || verb, null);
  return new;
end $$;
revoke all on function public.log_client_crm_change() from public;
create trigger client_contacts_activity after insert or update on public.client_contacts
  for each row execute function public.log_client_crm_change();
create trigger client_offices_activity after insert or update on public.client_offices
  for each row execute function public.log_client_crm_change();
create trigger client_contracts_activity after insert or update on public.client_contracts
  for each row execute function public.log_client_crm_change();

create or replace function public.keep_one_primary_client_contact() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.is_primary and new.archived_at is null then
    update public.client_contacts set is_primary=false, updated_at=now()
      where client_id=new.client_id and org_id=new.org_id and id<>new.id and is_primary and archived_at is null;
  end if;
  return new;
end $$;
create trigger client_contacts_primary before insert or update of is_primary, archived_at on public.client_contacts
  for each row execute function public.keep_one_primary_client_contact();
