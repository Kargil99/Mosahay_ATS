from datetime import datetime, timezone

from app.services.executive import build_executive_report


def test_executive_report_calculates_recruitment_finance_and_task_kpis():
    now = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)
    report = build_executive_report(
        jobs=[{"id": "job-1", "title": "Store Manager", "client_id": "client-1", "status": "open", "vacancies": 3, "created_at": "2026-11-01T00:00:00+00:00", "application_deadline": "2026-11-15"}],
        clients=[{"id": "client-1", "name": "Fictional Retail", "archived_at": None}],
        candidates=[{"id": "candidate-1", "source": "referral", "parse_status": "parsed"}, {"id": "candidate-2", "source": "job_board", "parse_status": "failed"}],
        applications=[
            {"id": "app-1", "job_id": "job-1", "candidate_id": "candidate-1", "owner_id": "recruiter-1", "stage": "Offer", "created_at": "2026-11-02T00:00:00+00:00", "stage_changed_at": "2026-11-10T00:00:00+00:00"},
            {"id": "app-2", "job_id": "job-1", "candidate_id": "candidate-2", "owner_id": "recruiter-1", "stage": "Hired", "created_at": "2026-11-03T00:00:00+00:00", "stage_changed_at": "2026-11-10T00:00:00+00:00"},
        ],
        submissions=[{"application_id": "app-1", "status": "submitted"}],
        interviews=[{"application_id": "app-1", "scheduled_at": "2026-11-12T12:00:00+00:00", "status": "scheduled"}],
        placements=[{"application_id": "app-2", "client_id": "client-1", "recruiter_id": "recruiter-1", "joining_date": "2026-11-10", "expected_fee": "50000", "payment_status": "paid", "status": "active"}],
        tasks=[{"status": "open", "due_at": "2026-11-11T10:00:00+00:00"}, {"status": "in_progress", "due_at": "2026-11-10T10:00:00+00:00"}, {"status": "open"}],
        stages=["New", "Offer", "Hired"], now=now,
    )
    assert report["kpis"]["active_clients"] == 1
    assert report["kpis"]["open_positions"] == 2
    assert report["kpis"]["candidates_screened"] == 2
    assert report["kpis"]["candidates_submitted"] == 1
    assert report["kpis"]["collected_placement_revenue"] == 50000
    assert report["conversion"]["submission_to_interview_pct"] == 100
    assert report["tasks"]["due_today"] == 1
    assert report["tasks"]["overdue"] == 1


def test_executive_report_does_not_count_partial_payments_as_fully_collected():
    report = build_executive_report(
        jobs=[], clients=[], candidates=[], applications=[], submissions=[], interviews=[],
        placements=[{"expected_fee": 1000, "payment_status": "partial", "status": "active"}], tasks=[], stages=[],
        now=datetime(2026, 11, 11, tzinfo=timezone.utc),
    )
    assert report["kpis"]["collected_placement_revenue"] == 0
    assert report["kpis"]["partial_payment_records"] == 1
