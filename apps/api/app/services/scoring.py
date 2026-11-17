"""Deterministic evidence matching. This ranks review evidence, never hiring likelihood."""
from __future__ import annotations

import re
from typing import Any

STATES = {"supported", "partially_supported", "not_evidenced", "possible_contradiction", "not_applicable"}
FORBIDDEN = re.compile(
    r"\b(age|gender|sex|photo|nationality|caste|religion|disability|health|hiv|marital|family|salary history|employment gap|institution prestige|culture fit)\b",
    re.I,
)


def validate_weights(requirements: list[dict[str, Any]]) -> None:
    active = [r for r in requirements if r.get("active", True)]
    if not active:
        raise ValueError("At least one active requirement is required")
    if any(FORBIDDEN.search(str(r.get("criterion", "") + " " + r.get("description", ""))) for r in active):
        raise ValueError("Sensitive or non-job-related criteria cannot be scored")
    if sum(int(r.get("weight", 0)) for r in active) != 100:
        raise ValueError("Active requirement weights must total 100")
    if any(int(r.get("weight", 0)) < 0 or int(r.get("weight", 0)) > 100 for r in active):
        raise ValueError("Requirement weights must be between 0 and 100")


def _terms(text: str) -> set[str]:
    return {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]{1,}", text)}


def _find_quote(text: str, terms: set[str]) -> str | None:
    for line in text.splitlines():
        cleaned = line.strip()
        if cleaned and len(terms.intersection(_terms(cleaned))) >= min(2, len(terms)):
            return cleaned[:500]
    return None


def score_requirements(requirements: list[dict[str, Any]], resume_text: str, rubric_version: int = 1,
                       extraction_quality: str = "complete") -> dict[str, Any]:
    """Score against exact resume snippets. Missing evidence remains null and outside denominator."""
    validate_weights(requirements)
    results = []
    assessed_weight = 0
    weighted = 0.0
    all_weight = sum(int(r["weight"]) for r in requirements if r.get("active", True))
    resume_terms = _terms(resume_text)
    for req in requirements:
        if not req.get("active", True):
            continue
        label = str(req.get("criterion", ""))
        description = str(req.get("description", ""))
        aliases = req.get("aliases") or []
        criterion_terms = _terms(" ".join([label, description, *[str(x) for x in aliases]]))
        # Ignore common connective words when measuring evidence overlap.
        criterion_terms -= {"and", "the", "with", "for", "from", "years", "experience", "knowledge", "ability", "skill"}
        overlap = criterion_terms.intersection(resume_terms)
        quote = _find_quote(resume_text, overlap) if overlap else None
        if not overlap or not quote:
            state, rating = "not_evidenced", None
            explanation = "Not evidenced in CV. Ask the candidate or recruiter to verify; this is not evidence of absence."
        elif re.search(rf"\b(?:no|not|without|never|lack(?:s|ing)?)\b[^\n]{{0,60}}\b(?:{'|'.join(re.escape(w) for w in sorted(overlap))})\b", quote, re.I):
            state, rating = "possible_contradiction", 0
            explanation = "The resume contains wording that may contradict this criterion. Verify it directly with the candidate."
            assessed_weight += int(req["weight"])
        else:
            ratio = len(overlap) / max(1, len(criterion_terms))
            rating = min(5, max(1, round(5 * ratio)))
            state = "supported" if ratio >= 0.6 else "partially_supported"
            explanation = f"Found {len(overlap)} matching term(s) in resume text; recruiter review is required."
            assessed_weight += int(req["weight"])
            weighted += int(req["weight"]) * rating / 5
        results.append({
            "requirement_id": req.get("id"), "criterion": label, "weight": int(req["weight"]),
            "rating": rating, "state": state, "explanation": explanation,
            "evidence_quote": quote, "source_section": None, "page": None,
            "evidence_valid": bool(quote and quote in resume_text),
            "confidence": "low" if extraction_quality != "complete" else ("medium" if quote else "low"),
            "review_warning": state != "supported" or extraction_quality != "complete",
            "rubric_version": rubric_version,
        })
    score = round(100 * weighted / assessed_weight) if assessed_weight else None
    coverage = round(100 * assessed_weight / all_weight) if all_weight else 0
    return {
        "match_score": score,
        "evidence_coverage": coverage,
        "confidence": "low" if coverage < 40 or extraction_quality != "complete" else ("medium" if coverage < 80 else "high"),
        "review_priority": "manual_review" if coverage < 40 or extraction_quality != "complete" else "review",
        "rubric_version": rubric_version,
        "criteria": results,
        "scoring_version": "deterministic-keyword-v1",
        "notice": "Advisory evidence summary only. This is not a probability of job success or a hiring decision.",
    }
