# RecruitOS API reference (v1)

Base path: `/api/v1`. Send `Authorization: Bearer <Supabase access token>` on authenticated requests. Bodies are JSON except CSV export and multipart resume/JD uploads. API errors use `{ "detail": { "error": { "code", "message" } } }`. The API and PostgreSQL RLS both enforce role and workspace access.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Safe health check outside the versioned API |
| GET | `/public/jobs` | Public open job listings with title, location, industry, compensation, experience, and employment filters |
| GET | `/public/jobs/{slug}` | Public job details and current candidate privacy notice |
| POST | `/public/jobs/{slug}/apply` | Multipart application with resume, explicit consent, private storage, and candidate access key issuance |
| POST | `/public/hire-talent` | Public employer inquiry; service-side RPC stores a private lead for manager review |
| GET | `/public/candidate-portal` | Candidate application status and profile; requires `X-Candidate-Access-Key` |
| PATCH | `/public/candidate-portal/profile` | Candidate updates phone, location, availability, and skills with access key |
| POST | `/public/candidate-portal/withdraw-consent` | Withdraw candidate consent and mark active applications withdrawn |
| POST | `/public/candidate-portal/privacy-requests` | Submit access/correction/export/deletion request with access key |
| GET/PATCH | `/employer-leads?org_id=…`, `/employer-leads/{lead_id}` | Manager-only lead queue and status updates |
| POST | `/employer-leads/{lead_id}/convert` | Convert a qualified employer lead into a client record |
| GET | `/me` | Current user and workspace roles |
| POST | `/organizations` | Create workspace; creator becomes owner |
| GET | `/dashboard?org_id=…` | Metrics from the caller's authorized database rows |
| GET/PATCH | `/organizations/{org_id}` | Read workspace settings; owner/admin write |
| GET | `/organizations/{org_id}/members` | List member IDs and roles (reviewers see only their own membership) |
| PATCH | `/organizations/{org_id}/members/{user_id}` | Change an existing non-owner role; owner/admin only |
| GET | `/organizations/{org_id}/audit-logs` | Read safe audit events; owner/admin only |
| GET/POST | `/clients?org_id=…` | List/create client companies |
| GET | `/clients/{client_id}/crm` | Read contacts, offices, client activity, and manager-visible contract terms |
| POST/PATCH | `/clients/{client_id}/contacts`, `/clients/{client_id}/contacts/{record_id}` | Add or update a contact; one active primary contact per client |
| POST/PATCH | `/clients/{client_id}/offices`, `/clients/{client_id}/offices/{record_id}` | Add or update an office; archive with `archived_at` |
| POST/PATCH | `/clients/{client_id}/contracts`, `/clients/{client_id}/contracts/{record_id}` | Create or update manager-controlled recruitment contract terms |
| POST | `/clients/{client_id}/activities` | Append a note, call, email, or meeting to the client timeline |
| GET/POST | `/jobs?org_id=…` | List/create jobs |
| GET/PATCH | `/jobs/{job_id}` | Read/update an authorized job |
| POST | `/jobs/{job_id}/parse-jd` | Return text-derived JD proposals for recruiter review |
| POST | `/jobs/{job_id}/jd-file` | Upload a private PDF/DOCX/TXT JD and extract text |
| POST | `/jobs/{job_id}/record-current-privacy-notice` | Link the workspace notice version to a job |
| GET/POST | `/jobs/{job_id}/reviewers` | List or assign workspace reviewers; admin assignment |
| POST | `/jobs/{job_id}/reviewers/invite` | Invite an email as a job-scoped reviewer using backend Supabase Auth; requires admin role and service-role configuration |
| DELETE | `/jobs/{job_id}/reviewers/{user_id}` | Remove a job-scoped reviewer assignment |
| GET/PUT | `/jobs/{job_id}/interview-questions` | Read or replace role-related interview questions |
| GET/POST | `/jobs/{job_id}/requirements` | List/add job scoring requirements |
| PATCH/DELETE | `/jobs/{job_id}/requirements/{requirement_id}` | Edit/remove a requirement |
| POST | `/jobs/{job_id}/resumes` | Upload PDF/DOCX/TXT resumes; per-file duplicate warnings include normalized email, phone, or exact file matches |
| POST | `/candidates/{candidate_id}/resumes` | Add a private parsed resume version to an existing candidate profile |
| GET | `/jobs/{job_id}/applications` | Paginated applications; sort by date, stage, score, or coverage |
| POST | `/candidates/import.csv?org_id=…` | Import up to 500 candidate profiles; normalized email/phone duplicates are returned for human review |
| GET/PATCH | `/candidates/{candidate_id}` | Read profile or correct editable fields |
| GET | `/candidates/{candidate_id}/resume-url?asset_id=…` | Create a 60-second private resume URL for the latest or selected version |
| POST/GET | `/applications/{id}/score`, `/score-runs` | Create deterministic evidence score / read recent history |
| POST | `/jobs/{job_id}/bulk-score` | Score 1–100 selected applications for the job; unreadable resumes return per-application manual-review errors |
| POST | `/applications/{id}/score-overrides` | Add reasoned score override; preserve score-run history |
| PATCH | `/applications/{id}/stage` | Persist a hiring stage; final outcomes require a human reason |
| PATCH | `/applications/{id}/assign` | Assign application to an in-workspace recruiter |
| GET/POST | `/applications/{id}/notes` | Read/add internal recruiter notes |
| GET/POST | `/applications/{id}/scorecards` | Read/submit structured human interview feedback |
| GET/POST/PATCH | `/tasks`, `/tasks/{task_id}` | Create, list and update owned or assigned follow-up tasks |
| GET | `/interviews?org_id=…` | List authorized interviews |
| POST | `/applications/{id}/interviews` | Schedule an interview |
| PATCH | `/interviews/{id}` | Update interview status, time, or feedback |
| POST | `/applications/{id}/submit-to-client` | Create contact-minimized snapshot after sharing notice check |
| GET | `/submissions?org_id=…` | Read internal submission history |
| GET/PATCH | `/client-portal/submissions`, `/client-portal/submissions/{id}` | Assigned reviewers read snapshots and submit a constrained response |
| GET/POST | `/placements?org_id=…`, `/placements` | List/create placement fee records |
| PATCH | `/placements/{placement_id}` | Update invoice, payment or placement status |
| POST/PATCH | `/placements/{placement_id}/replacements`, `/replacements/{id}` | Open/update a replacement guarantee case |
| GET | `/activity?org_id=…` | Read recent activity allowed to the user's role |
| GET | `/analytics/pipeline?org_id=…` | Per-job/stage counts, source counts, stage age and time-to-fill |
| GET | `/analytics/executive?org_id=…` | Manager-only business, placement, recruiter, client, funnel, and task metrics; supports date/recruiter/client/industry/role/location filters |
| GET | `/analytics/export.csv?org_id=…` | Workspace-scoped CSV export |
| GET/POST | `/privacy-requests?org_id=…` | List admin requests / create authorized request records |
| PATCH | `/privacy-requests/{id}` | Update request state and resolution notes |
| POST | `/privacy-requests/{id}/fulfill-deletion` | Anonymize linked candidate, remove resumes and redact score evidence |

All list endpoints are bounded. Resume files are private and never returned as public paths. Client reviewer access is based on a reviewer membership and job assignment. Reviewer responses can only set an allowed decision and feedback; direct submission row updates, candidate profiles, internal notes, and resume access are restricted by database policy.

Scores have nullable values when evidence is insufficient, separate evidence coverage, criterion states, and source citations. Scores do not decide candidate outcomes.
