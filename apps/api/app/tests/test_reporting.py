from datetime import datetime, timezone

from app.services.reporting import build_pipeline_report


def test_pipeline_report_uses_stage_source_and_hire_timestamps():
    now = datetime(2026, 10, 29, tzinfo=timezone.utc)
    rows = [
        {
            "id": "application-1", "candidate_id": "candidate-1", "job_id": "job-1", "stage": "Hired",
            "stage_changed_at": "2026-10-27T00:00:00Z",
            "jobs": {"title": "Analyst", "created_at": "2026-10-19T00:00:00Z"},
            "candidates": {"source": "referral"},
        },
        {
            "id": "application-2", "candidate_id": "candidate-1", "job_id": "job-2", "stage": "Hired",
            "stage_changed_at": "2026-10-27T00:00:00Z",
            "jobs": {"title": "Researcher", "created_at": "2026-10-17T00:00:00Z"},
            "candidates": {"source": "referral"},
        },
        {
            "id": "application-3", "candidate_id": "candidate-2", "job_id": "job-1", "stage": "Interview",
            "stage_changed_at": "2026-10-25T00:00:00Z", "jobs": {"title": "Analyst"},
            "candidates": {"source": None},
        },
    ]

    report = build_pipeline_report(rows, ["Hired", "Interview"], now)

    assert report["total"] == 3
    assert report["by_stage"] == {"Hired": 2, "Interview": 1}
    assert report["source_counts"] == {"referral": 1, "unknown": 1}
    assert report["average_days_in_current_stage"] == {"Hired": 2.0, "Interview": 4.0}
    assert report["completed_hires"] == 2
    assert report["average_time_to_fill_days"] == 9.0
    assert report["median_time_to_fill_days"] == 9.0
    assert next(job for job in report["by_job"] if job["job_id"] == "job-1")["total"] == 2
