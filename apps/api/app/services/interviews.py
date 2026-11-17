"""Validation for job-specific human interview scorecard prompts."""
from __future__ import annotations

import re

NON_JOB_RELATED = re.compile(r"\b(age|old|year of birth|date of birth|gender|sex|photo|nationality|caste|religion|disability|health|hiv|marital|family|salary history|employment gap|institution prestige|culture fit)\b", re.I)


def validate_interview_questions(value: object) -> list[str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise ValueError("Provide between 1 and 12 job-related interview questions.")
    if any(not isinstance(item, str) for item in value):
        raise ValueError("Each question must be text containing 5 to 300 characters.")
    cleaned = [item.strip() for item in value]
    if any(not 5 <= len(item) <= 300 for item in cleaned):
        raise ValueError("Each question must contain 5 to 300 characters.")
    if len({item.casefold() for item in cleaned}) != len(cleaned):
        raise ValueError("Interview questions must be unique.")
    if any(NON_JOB_RELATED.search(item) for item in cleaned):
        raise ValueError("Questions must assess role-related evidence only.")
    return cleaned
