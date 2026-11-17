from pathlib import Path


def test_migration_enables_rls_and_private_resume_storage():
    migration = Path(__file__).parents[4] / "supabase" / "migrations" / "202610290001_initial_schema.sql"
    sql = migration.resolve().read_text(encoding="utf-8").lower()
    assert "enable row level security" in sql
    assert "values('candidate-resumes','candidate-resumes',false" in sql
    assert "create policy resumes_read_assigned" in sql
    assert "create or replace function public.can_review_job" in sql
    assert "applications_final_decision_ck" in sql
    assert "foreign key(candidate_id,org_id) references public.candidates(id,org_id)" in sql


def test_client_crm_migration_scopes_crm_data_and_restricts_contract_terms():
    migration = Path(__file__).parents[4] / "supabase" / "migrations" / "202611110007_client_crm.sql"
    sql = migration.resolve().read_text(encoding="utf-8").lower()
    assert "create table public.client_contacts" in sql
    assert "create table public.client_offices" in sql
    assert "create table public.client_contracts" in sql
    assert "create table public.client_activity_logs" in sql
    assert "alter table public.client_contracts enable row level security" in sql
    assert "public.has_org_role(org_id, array['owner','admin','recruitment_manager']::public.workspace_role[])" in sql
    assert "client_contacts_primary" in sql
