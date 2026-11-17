from datetime import date, datetime
from decimal import Decimal
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class ClientCreate(BaseModel):
    org_id: str
    name: str = Field(min_length=1, max_length=180)
    website: str | None = None
    notes: str | None = None


class ClientContactCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=180)
    title: str | None = Field(default=None, max_length=180)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=40)
    office_id: str | None = None
    is_primary: bool = False
    notes: str | None = Field(default=None, max_length=5000)


class ClientContactUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=180)
    title: str | None = Field(default=None, max_length=180)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=40)
    office_id: str | None = None
    is_primary: bool | None = None
    notes: str | None = Field(default=None, max_length=5000)
    archived_at: datetime | None = None


class ClientOfficeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    country: str = Field(default="India", min_length=2, max_length=120)
    postal_code: str | None = Field(default=None, max_length=30)
    notes: str | None = Field(default=None, max_length=5000)


class ClientOfficeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, min_length=2, max_length=120)
    postal_code: str | None = Field(default=None, max_length=30)
    notes: str | None = Field(default=None, max_length=5000)
    archived_at: datetime | None = None


class ClientContractCreate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    contract_number: str | None = Field(default=None, max_length=100)
    status: Literal["draft", "active", "expired", "terminated"] = "draft"
    fee_model: Literal["fixed", "percentage", "milestone", "custom"]
    fee_value: Decimal = Field(ge=0, le=100_000_000_000)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    valid_from: date | None = None
    valid_until: date | None = None
    guarantee_months: int = Field(default=0, ge=0, le=36)
    payment_terms: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def valid_contract_dates(self):
        if self.valid_from and self.valid_until and self.valid_until < self.valid_from:
            raise ValueError("Contract end date must be on or after its start date.")
        if self.fee_model == "percentage" and self.fee_value > 100:
            raise ValueError("Percentage fees must be between 0 and 100.")
        return self


class ClientContractUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    contract_number: str | None = Field(default=None, max_length=100)
    status: Literal["draft", "active", "expired", "terminated"] | None = None
    fee_model: Literal["fixed", "percentage", "milestone", "custom"] | None = None
    fee_value: Decimal | None = Field(default=None, ge=0, le=100_000_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    valid_from: date | None = None
    valid_until: date | None = None
    guarantee_months: int | None = Field(default=None, ge=0, le=36)
    payment_terms: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=5000)


class ClientActivityCreate(BaseModel):
    activity_type: Literal["note", "call", "email", "meeting"]
    subject: str = Field(min_length=1, max_length=180)
    details: str | None = Field(default=None, max_length=10000)
    happened_at: datetime | None = None


class JobCreate(BaseModel):
    org_id: str
    title: str = Field(min_length=2, max_length=180)
    description: str = ""
    client_id: str | None = None
    location: str | None = None
    work_arrangement: str | None = None
    employment_type: str | None = None
    vacancies: int | None = Field(default=None, ge=1, le=10000)
    salary_min: Decimal | None = Field(default=None, ge=0)
    salary_max: Decimal | None = Field(default=None, ge=0)
    salary_currency: str = Field(default="INR", min_length=3, max_length=3)
    experience_min: Decimal | None = Field(default=None, ge=0, le=100)
    experience_max: Decimal | None = Field(default=None, ge=0, le=100)
    application_deadline: date | None = None
    department: str | None = Field(default=None, max_length=120)
    industry: str | None = Field(default=None, max_length=120)
    status: str = "draft"

    @field_validator("salary_max")
    @classmethod
    def salary_max_not_below_min(cls, value: Decimal | None, info):
        minimum = info.data.get("salary_min")
        if value is not None and minimum is not None and value < minimum:
            raise ValueError("Maximum salary must be at least the minimum salary.")
        return value

    @field_validator("experience_max")
    @classmethod
    def experience_max_not_below_min(cls, value: Decimal | None, info):
        minimum = info.data.get("experience_min")
        if value is not None and minimum is not None and value < minimum:
            raise ValueError("Maximum experience must be at least the minimum experience.")
        return value


class RequirementCreate(BaseModel):
    org_id: str
    criterion: str = Field(min_length=2, max_length=200)
    description: str = ""
    required: bool = True
    weight: int = Field(ge=0, le=100)
    aliases: list[str] = []


class BulkScoreCreate(BaseModel):
    application_ids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("application_ids")
    @classmethod
    def unique_application_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Choose each application only once.")
        return value


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class StageChange(BaseModel):
    stage: str
    decision_reason: str | None = None


class PrivacyRequestCreate(BaseModel):
    org_id: str
    candidate_id: str | None = None
    request_type: str = Field(pattern="^(access|correction|export|consent_withdrawal|deletion)$")
    details: str = Field(min_length=3, max_length=5000)


class JobPosterCreate(BaseModel):
    org_id: str
    title: str = Field(min_length=1, max_length=180)
    template_id: Literal["corporate", "manufacturing", "warehouse", "logistics", "retail", "technology", "fresher", "walkin", "urgent", "hospitality", "healthcare", "skilled-trades"]
    format: Literal["square", "portrait", "story", "linkedin", "whatsapp", "a4"]
    language: Literal["en", "hi", "or"] = "en"
    poster_copy: dict[str, str]
    style: dict[str, str | int] = Field(default_factory=dict)

    @field_validator("poster_copy")
    @classmethod
    def validate_copy(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 16 or any(not isinstance(k, str) or not isinstance(v, str) or len(v) > 2000 for k, v in value.items()):
            raise ValueError("Poster copy must contain at most 16 text fields of 2,000 characters each.")
        return value


class JobPosterUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    template_id: Literal["corporate", "manufacturing", "warehouse", "logistics", "retail", "technology", "fresher", "walkin", "urgent", "hospitality", "healthcare", "skilled-trades"] | None = None
    format: Literal["square", "portrait", "story", "linkedin", "whatsapp", "a4"] | None = None
    language: Literal["en", "hi", "or"] | None = None
    poster_copy: dict[str, str] | None = None
    style: dict[str, str | int] | None = None
    status: Literal["draft", "approved", "archived"] | None = None


class RecruiterTaskCreate(BaseModel):
    org_id: str
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(default="", max_length=5000)
    assigned_to: str | None = None
    candidate_id: str | None = None
    job_id: str | None = None
    client_id: str | None = None
    application_id: str | None = None
    due_at: datetime | None = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"


class RecruiterTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=5000)
    assigned_to: str | None = None
    due_at: datetime | None = None
    priority: Literal["low", "normal", "high", "urgent"] | None = None
    status: Literal["open", "in_progress", "completed", "cancelled"] | None = None


class InterviewCreate(BaseModel):
    scheduled_at: datetime
    duration_minutes: int = Field(default=60, ge=15, le=480)
    mode: Literal["onsite", "video", "phone"]
    location: str | None = Field(default=None, max_length=500)
    meeting_link: str | None = Field(default=None, max_length=1000)


class InterviewUpdate(BaseModel):
    scheduled_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=15, le=480)
    mode: Literal["onsite", "video", "phone"] | None = None
    location: str | None = Field(default=None, max_length=500)
    meeting_link: str | None = Field(default=None, max_length=1000)
    status: Literal["scheduled", "completed", "cancelled", "no_show"] | None = None
    feedback_summary: str | None = Field(default=None, max_length=5000)


class PlacementCreate(BaseModel):
    application_id: str
    joining_date: date
    designation: str = Field(min_length=2, max_length=180)
    agreed_ctc: Decimal | None = Field(default=None, ge=0)
    fee_model: Literal["fixed", "percentage", "milestone", "custom"]
    fee_value: Decimal = Field(ge=0)
    guarantee_months: int = Field(default=0, ge=0, le=36)
    recruiter_id: str | None = None
    notes: str = Field(default="", max_length=5000)


class PlacementUpdate(BaseModel):
    invoice_status: Literal["not_invoiced", "draft", "issued", "paid", "overdue"] | None = None
    payment_status: Literal["pending", "partial", "paid", "overdue"] | None = None
    status: Literal["active", "replacement_due", "replaced", "completed"] | None = None
    notes: str | None = Field(default=None, max_length=5000)


class ReplacementCreate(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)
    due_date: date | None = None


class ReplacementUpdate(BaseModel):
    status: Literal["open", "in_progress", "filled", "closed"]
    replacement_candidate_id: str | None = None


class SubmissionReview(BaseModel):
    status: Literal["accepted", "rejected", "interview_requested", "more_information_requested"]
    feedback: str = Field(default="", max_length=5000)


class ApplicationAssignment(BaseModel):
    assigned_to: str = Field(min_length=1, max_length=80)


class ReviewerInviteCreate(BaseModel):
    email: str = Field(min_length=5, max_length=254)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value


class PublicCandidateProfileUpdate(BaseModel):
    phone: str = Field(min_length=7, max_length=40)
    city: str = Field(default="", max_length=120)
    preferred_location: str = Field(default="", max_length=120)
    availability: str = Field(default="", max_length=120)
    skills: list[str] = Field(default_factory=list, max_length=30)


class PublicPrivacyRequestCreate(BaseModel):
    request_type: Literal["access", "correction", "export", "consent_withdrawal", "deletion"]
    details: str = Field(min_length=3, max_length=5000)


class EmployerLeadCreate(BaseModel):
    company_name: str = Field(min_length=2, max_length=180)
    website: str | None = Field(default=None, max_length=300)
    contact_name: str = Field(min_length=2, max_length=180)
    email: str = Field(min_length=5, max_length=254)
    phone: str = Field(min_length=7, max_length=40)
    job_title: str = Field(min_length=2, max_length=180)
    vacancies: int = Field(ge=1, le=10000)
    required_skills: list[str] = Field(default_factory=list, max_length=50)
    location: str = Field(min_length=1, max_length=180)
    experience: str | None = Field(default=None, max_length=180)
    salary_min: float | None = Field(default=None, ge=0, le=100_000_000)
    salary_max: float | None = Field(default=None, ge=0, le=100_000_000)
    hiring_timeline: str = Field(min_length=2, max_length=180)


class EmployerLeadStatusUpdate(BaseModel):
    status: Literal["new", "contacted", "qualified", "declined"]
