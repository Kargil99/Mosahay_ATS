from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date

from docx import Document
from pypdf import PdfReader

ALLOWED = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain"}
DATE = re.compile(r"\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}|\d{1,2}/\d{4}|\d{4})\b", re.I)
MONTHS = {name.lower(): i for i, name in enumerate(("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"), 1)}


@dataclass
class ParsedResume:
    text: str
    profile: dict
    warnings: list[str]
    status: str
    sha256: str


def extract_text(filename: str, content: bytes, max_bytes: int) -> str:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED:
        raise ValueError("Unsupported file type. Upload PDF, DOCX, or TXT.")
    if not content or len(content) > max_bytes:
        raise ValueError("File is empty or exceeds the configured size limit.")
    if ext == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise ValueError("File content does not match its PDF extension.")
        try:
            return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages).strip()
        except Exception as exc:
            raise ValueError("PDF could not be read.") from exc
    if ext == ".docx":
        if not content.startswith(b"PK"):
            raise ValueError("File content does not match its DOCX extension.")
        try:
            return "\n".join(p.text for p in Document(io.BytesIO(content)).paragraphs).strip()
        except Exception as exc:
            raise ValueError("DOCX could not be read.") from exc
    if b"\x00" in content:
        raise ValueError("Text file contains binary content.")
    try:
        text = content.decode("utf-8-sig").strip()
        if re.match(r"\s*(?:<!doctype\s+html|<html\b)", text, re.I):
            raise ValueError("HTML content is not accepted as a text resume.")
        return text
    except UnicodeDecodeError as exc:
        raise ValueError("Text file must use UTF-8 encoding.") from exc


def parse_resume(filename: str, content: bytes, max_bytes: int) -> ParsedResume:
    text = extract_text(filename, content, max_bytes)
    warnings: list[str] = []
    status = "parsed"
    if len(text) < 40:
        warnings.append("Very little text was extracted. Scanned or image-only resumes need manual review.")
        status = "needs_manual_review"
    email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.I)
    phone_match = re.search(r"(?:\+?\d[\d\s().-]{7,}\d)", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    name = lines[0][:120] if lines and len(lines[0].split()) <= 5 and "@" not in lines[0] else None
    skills = []
    if lines:
        for line in lines:
            if re.search(r"\b(skills?|technologies|tools)\b", line, re.I):
                payload = re.split(r"[:,|•]", line, maxsplit=1)[-1]
                skills = [x.strip() for x in re.split(r"[,;|•]", payload) if x.strip()][:30]
                break
    experiences = []
    periods: list[tuple[date, date]] = []
    for line in lines:
        date_range = re.search(rf"({DATE.pattern})\s*(?:-|–|—|to)\s*({DATE.pattern}|present|current|now)", line, re.I)
        if not date_range:
            continue
        start = _month_date(date_range.group(1))
        end = _month_date(date_range.group(2), allow_current=True)
        if start and end and end >= start:
            periods.append((start, end))
            left = line[:date_range.start()].strip(" |,;–—-")
            title, employer = _split_title_employer(left)
            experiences.append({"title": title, "employer": employer, "start_date": start.isoformat(),
                                "end_date": None if re.fullmatch(r"\s*(present|current|now)\s*", date_range.group(2), re.I) else end.isoformat(),
                                "is_current": bool(re.fullmatch(r"\s*(present|current|now)\s*", date_range.group(2), re.I)), "evidence_quote": line[:500]})
    education = []
    certs = []
    section = ""
    for line in lines:
        if re.match(r"^(education|academic background|qualifications?)\b", line, re.I):
            section = "education"; continue
        if re.match(r"^(certifications?|licenses?)\b", line, re.I):
            section = "certification"; continue
        if re.match(r"^(experience|employment|work history|skills?|projects?|summary|profile)\b", line, re.I):
            section = "other"; continue
        if section == "education" and len(line) < 220:
            education.append({"evidence_quote": line})
        elif section == "certification" and len(line) < 220:
            certs.append(line)
    merged_periods: list[list[date]] = []
    for start, end in sorted(periods):
        if not merged_periods or start > merged_periods[-1][1]:
            merged_periods.append([start, end])
        elif end > merged_periods[-1][1]:
            merged_periods[-1][1] = end
    months_total = sum(max(1, (end.year - start.year) * 12 + end.month - start.month) for start, end in merged_periods)
    approximate_years = round(months_total / 12, 1) if periods else None
    latest_experience = next((row for row in experiences if row["is_current"]), None) or (max(experiences, key=lambda row: row["start_date"]) if experiences else None)
    return ParsedResume(
        text=text,
        profile={"full_name": name, "email": email_match.group(0) if email_match else None,
                 "phone": phone_match.group(0) if phone_match else None, "skills": skills,
                 "current_title": latest_experience["title"] if latest_experience else None,
                 "current_employer": latest_experience["employer"] if latest_experience else None,
                 "experiences": experiences, "educations": education, "certifications": certs,
                 "approximate_experience_years": approximate_years,
                 "source": "recruiter_upload"},
        warnings=warnings, status=status, sha256=hashlib.sha256(content).hexdigest(),
    )


def _month_date(value: str, allow_current: bool = False) -> date | None:
    if allow_current and re.fullmatch(r"(?:present|current|now)", value.strip(), re.I):
        today = date.today()
        return date(today.year, today.month, 1)
    value = value.strip()
    if re.fullmatch(r"\d{4}", value):
        return date(int(value), 1, 1)
    if "/" in value:
        first, year = value.split("/", 1)
        month = int(first)
        return date(int(year), month, 1) if 1 <= month <= 12 else None
    match = re.search(r"([A-Za-z]+)\s+(\d{4})", value)
    if match:
        month = next((number for name, number in MONTHS.items() if name.startswith(match.group(1).lower()[:3])), None)
        if month:
            return date(int(match.group(2)), month, 1)
    return None


def _split_title_employer(value: str) -> tuple[str | None, str | None]:
    value = value.strip(" |,;–—-")
    if not value:
        return None, None
    match = re.search(r"\s+at\s+", value, re.I)
    if match:
        return value[:match.start()].strip(" |,;–—-") or None, value[match.end():].strip(" |,;–—-") or None
    for separator in (" | ", " — ", " – ", " - ", ", "):
        if separator in value:
            left, right = value.split(separator, 1)
            if left.strip() and right.strip():
                return left.strip(), right.strip()
    return value[:120], None
