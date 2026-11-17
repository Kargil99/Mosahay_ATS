"""Workspace-scoped, timestamp-backed pipeline summaries."""
from __future__ import annotations

from datetime import datetime, timezone
from statistics import median
from typing import Any


def _date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def build_pipeline_report(rows: list[dict[str, Any]], stages: list[str], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    by_stage = {stage: 0 for stage in stages}
    by_job: dict[str, dict[str, Any]] = {}
    source_candidates: dict[str, set[str]] = {}
    stage_days: dict[str, list[float]] = {}
    hire_days: list[float] = []

    for row in rows:
        stage = row.get("stage")
        if stage in by_stage:
            by_stage[stage] += 1
        job_id = row.get("job_id") or "unknown"
        job = row.get("jobs") or {}
        summary = by_job.setdefault(job_id, {"job_id": job_id, "title": job.get("title") or "Untitled job", "total": 0, "by_stage": {key: 0 for key in stages}})
        summary["total"] += 1
        if stage in summary["by_stage"]:
            summary["by_stage"][stage] += 1

        candidate = row.get("candidates") or {}
        source = (candidate.get("source") or "unknown").strip() or "unknown"
        source_candidates.setdefault(source, set()).add(row.get("candidate_id") or row.get("id") or "unknown")

        changed = _date(row.get("stage_changed_at"))
        if changed:
            stage_days.setdefault(stage or "unknown", []).append(max(0.0, (now - changed).total_seconds() / 86400))
            created = _date(job.get("created_at"))
            if stage == "Hired" and created:
                hire_days.append(max(0.0, (changed - created).total_seconds() / 86400))

    return {
        "total": len(rows),
        "by_stage": by_stage,
        "by_job": list(by_job.values()),
        "source_counts": {source: len(candidate_ids) for source, candidate_ids in source_candidates.items()},
        "average_days_in_current_stage": {stage: round(sum(values) / len(values), 1) for stage, values in stage_days.items() if values},
        "completed_hires": len(hire_days),
        "average_time_to_fill_days": round(sum(hire_days) / len(hire_days), 1) if hire_days else None,
        "median_time_to_fill_days": round(median(hire_days), 1) if hire_days else None,
    }
