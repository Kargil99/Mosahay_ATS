"""Server-side management metrics assembled from authorized workspace records."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from app.services.reporting import build_pipeline_report


def _instant(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _amount(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def build_executive_report(
    *, jobs: list[dict[str, Any]], clients: list[dict[str, Any]], candidates: list[dict[str, Any]],
    applications: list[dict[str, Any]], submissions: list[dict[str, Any]], interviews: list[dict[str, Any]],
    placements: list[dict[str, Any]], tasks: list[dict[str, Any]], stages: list[str],
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    active_jobs = [job for job in jobs if job.get("status") == "open"]
    hired_by_job: dict[str, int] = defaultdict(int)
    for app in applications:
        if app.get("stage") == "Hired":
            hired_by_job[app.get("job_id") or ""] += 1

    stage_counts = {stage: sum(1 for item in applications if item.get("stage") == stage) for stage in stages}
    screened_stages = {"Shortlisted", "Recruiter Screen", "Submitted to Client", "Interview", "Offer", "Hired", "Rejected"}
    screened_candidates = {item.get("candidate_id") for item in applications if item.get("stage") in screened_stages}
    submitted_apps = {item.get("application_id") for item in submissions if item.get("status") != "withdrawn"}
    scheduled_interviews = [item for item in interviews if item.get("status") == "scheduled" and (_instant(item.get("scheduled_at")) or now) >= now]
    offers = {item.get("id") for item in applications if item.get("stage") in {"Offer", "Hired"}}

    successful_placements = [item for item in placements if item.get("status") in {"active", "completed"}]
    expected_revenue = sum(_amount(item.get("expected_fee")) for item in placements)
    collected_revenue = sum(_amount(item.get("expected_fee")) for item in placements if item.get("payment_status") == "paid")
    outstanding_statuses = {"pending", "overdue"}
    outstanding_revenue = sum(_amount(item.get("expected_fee")) for item in placements if item.get("payment_status") in outstanding_statuses)
    partial_payment_count = sum(1 for item in placements if item.get("payment_status") == "partial")

    monthly: dict[str, dict[str, Any]] = defaultdict(lambda: {"applications": 0, "placements": 0, "expected_fee": 0.0, "paid_fee": 0.0})
    for item in applications:
        date_value = _instant(item.get("created_at"))
        if date_value:
            month = date_value.strftime("%Y-%m")
            monthly[month]["applications"] += 1
    for item in placements:
        month = str(item.get("joining_date") or "")[:7]
        if len(month) == 7:
            monthly[month]["placements"] += 1
            monthly[month]["expected_fee"] += _amount(item.get("expected_fee"))
            if item.get("payment_status") == "paid":
                monthly[month]["paid_fee"] += _amount(item.get("expected_fee"))

    recruiters: dict[str, dict[str, Any]] = defaultdict(lambda: {"applications": 0, "screened": 0, "placements": 0, "expected_fee": 0.0})
    for item in applications:
        recruiter_id = item.get("owner_id")
        if recruiter_id:
            row = recruiters[str(recruiter_id)]
            row["applications"] += 1
            row["screened"] += int(item.get("stage") in screened_stages)
    for item in placements:
        recruiter_id = item.get("recruiter_id")
        if recruiter_id:
            row = recruiters[str(recruiter_id)]
            row["placements"] += 1
            row["expected_fee"] += _amount(item.get("expected_fee"))

    clients_by_id = {str(item.get("id")): item for item in clients}
    client_metrics: dict[str, dict[str, Any]] = defaultdict(lambda: {"open_jobs": 0, "applications": 0, "placements": 0, "expected_fee": 0.0})
    jobs_by_id = {str(item.get("id")): item for item in jobs}
    for job in jobs:
        client_id = job.get("client_id")
        if client_id:
            client_metrics[str(client_id)]["open_jobs"] += int(job.get("status") == "open")
    for app in applications:
        job = jobs_by_id.get(str(app.get("job_id")))
        client_id = job.get("client_id") if job else None
        if client_id:
            client_metrics[str(client_id)]["applications"] += 1
    for item in placements:
        client_id = item.get("client_id")
        if client_id:
            row = client_metrics[str(client_id)]
            row["placements"] += 1
            row["expected_fee"] += _amount(item.get("expected_fee"))

    client_performance = [
        {"client_id": client_id, "name": clients_by_id.get(client_id, {}).get("name", "Client"), **metrics}
        for client_id, metrics in client_metrics.items()
    ]
    source_counts: dict[str, set[str]] = defaultdict(set)
    for candidate in candidates:
        source = str(candidate.get("source") or "unknown").strip() or "unknown"
        source_counts[source].add(str(candidate.get("id") or ""))

    today = now.date()
    due_today = [item for item in tasks if item.get("status") in {"open", "in_progress"} and item.get("due_at") and (_instant(item.get("due_at")) or now).date() == today]
    overdue = [item for item in tasks if item.get("status") in {"open", "in_progress"} and item.get("due_at") and (_instant(item.get("due_at")) or now).date() < today]
    deadline_soon = []
    for item in jobs:
        if item.get("status") != "open" or not item.get("application_deadline"):
            continue
        try:
            deadline = datetime.fromisoformat(str(item["application_deadline"])).date()
        except ValueError:
            continue
        if today <= deadline <= today.fromordinal(today.toordinal() + 7):
            deadline_soon.append({"job_id": item.get("id"), "title": item.get("title"), "application_deadline": item.get("application_deadline")})

    pipeline_rows = []
    candidates_by_id = {str(item.get("id")): item for item in candidates}
    applications_by_id = {str(item.get("id")): item for item in applications}
    for app in applications:
        job = jobs_by_id.get(app.get("job_id"), {})
        candidate = candidates_by_id.get(str(app.get("candidate_id")), {})
        pipeline_rows.append({**app, "jobs": {"title": job.get("title"), "created_at": job.get("created_at")}, "candidates": {"source": candidate.get("source")}})
    pipeline = build_pipeline_report(pipeline_rows, stages, now)

    today_items = sorted(due_today, key=lambda item: _instant(item.get("due_at")) or now)[:10]
    overdue_items = sorted(overdue, key=lambda item: _instant(item.get("due_at")) or now)[:10]
    upcoming_interview_items = []
    for item in sorted(scheduled_interviews, key=lambda row: _instant(row.get("scheduled_at")) or now)[:10]:
        application = applications_by_id.get(str(item.get("application_id")), {})
        candidate = candidates_by_id.get(str(application.get("candidate_id")), {})
        job = jobs_by_id.get(str(item.get("job_id")), {})
        upcoming_interview_items.append({"scheduled_at": item.get("scheduled_at"), "candidate_name": candidate.get("full_name") or "Candidate", "job_title": job.get("title") or "Role"})

    interview_application_ids = {item.get("application_id") for item in interviews if item.get("status") != "cancelled"}
    joined_count = len(placements)
    return {
        "kpis": {
            "active_clients": sum(1 for item in clients if not item.get("archived_at")),
            "active_requirements": len(active_jobs),
            "open_positions": sum(max(0, int(job.get("vacancies") or 0) - hired_by_job.get(str(job.get("id")), 0)) for job in active_jobs),
            "candidate_count": len(candidates),
            "candidates_screened": len(screened_candidates),
            "candidates_submitted": len(submitted_apps),
            "interviews_scheduled": len(scheduled_interviews),
            "offers_released": len(offers),
            "candidates_joined": joined_count,
            "successful_placements": len(successful_placements),
            "expected_placement_revenue": round(expected_revenue, 2),
            "collected_placement_revenue": round(collected_revenue, 2),
            "pending_client_payments": sum(1 for item in placements if item.get("payment_status") in outstanding_statuses),
            "outstanding_expected_fee": round(outstanding_revenue, 2),
            "partial_payment_records": partial_payment_count,
        },
        "monthly_performance": [{"month": month, **monthly[month]} for month in sorted(monthly)[-12:]],
        "by_stage": pipeline["by_stage"],
        "by_job": pipeline["by_job"],
        "source_counts": pipeline["source_counts"],
        "average_days_in_current_stage": pipeline["average_days_in_current_stage"],
        "candidate_funnel": stage_counts,
        "requirements_by_status": {status: sum(1 for job in jobs if job.get("status") == status) for status in ("draft", "open", "paused", "filled", "archived")},
        "recruiter_performance": [{"recruiter_id": key, **value} for key, value in recruiters.items()],
        "client_performance": sorted(client_performance, key=lambda item: (-item["placements"], -item["open_jobs"], item["name"]))[:50],
        "source_performance": {key: len(value) for key, value in source_counts.items()},
        "conversion": {
            "submission_to_interview_pct": round(100 * len(submitted_apps & interview_application_ids) / len(submitted_apps), 1) if submitted_apps else None,
            "interview_to_offer_pct": round(100 * len(offers & interview_application_ids) / len(interview_application_ids), 1) if interview_application_ids else None,
            "offer_to_joining_pct": round(100 * joined_count / len(offers), 1) if offers else None,
        },
        "time_to_fill": {"average_days": pipeline["average_time_to_fill_days"], "median_days": pipeline["median_time_to_fill_days"], "completed_hires": pipeline["completed_hires"]},
        "tasks": {"due_today": len(due_today), "overdue": len(overdue), "upcoming_interviews": len(scheduled_interviews),
                  "today_items": today_items, "overdue_items": overdue_items, "upcoming_interview_items": upcoming_interview_items,
                  "requirements_deadline_soon": deadline_soon},
        "monthly_revenue": [{"month": row["month"], "expected_fee": round(row["expected_fee"], 2), "paid_fee": round(row["paid_fee"], 2)} for row in [{"month": month, **monthly[month]} for month in sorted(monthly)[-12:]]],
    }
