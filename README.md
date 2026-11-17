# MoSahay RecruitOS

**Putting people to productive work.** RecruitOS is MoSahay's internal recruitment workspace for coordinating clients, job requirements, candidates, evidence-based matching, submissions, interviews, follow-ups, posters, placements, fees, and team activity.

The supplied README template is retained at [docs/README_ATS_template.md](docs/README_ATS_template.md). This file documents the implementation in this repository.

> Candidate fit scores summarize resume evidence and support human review. They do not make hiring decisions, rank protected traits, or automatically reject candidates.

## Product and launch status

The internal ATS, API, password authentication, Google OAuth, team invitations, and public application workflows use MongoDB. The main API does not require Supabase. Local browser demo mode remains available when the backend has no MongoDB connection, but demo changes stay in that browser and do not represent shared team data.

This checkout has not been deployed, and no MongoDB, Google OAuth, or OpenAI credentials are included. Configure those services in the API deployment environment before inviting the team or processing real candidate information. Google sign-in and AI features stay disabled until their keys are set. Team invitations create an expiring link for the admin to copy; email delivery is not configured.

## Included workflows

- Email/password account creation and sign-in with secure, HTTP-only JWT session cookies; optional Google sign-in and linking to a matching verified email.
- Workspace creation, workspace roles, one-time team invite links, reviewer invitations, and role assignment.
- MongoDB persistence for clients, job requirements, candidates, applications, notes, job-specific rubrics, score history, submissions, interviews, tasks, placements, fees, replacement records, audit activity, and workspace settings.
- Private resume and job-description storage in MongoDB GridFS, signed short-lived resume download URLs, PDF/DOCX/TXT extraction, duplicate warnings, CSV candidate import, and manual-review status for low-text files.
- Deterministic match scores with criterion-level evidence, evidence coverage, versioned score history, bulk scoring, and human-reviewed score overrides. Optional AI resume fact extraction is server-side and requires workspace notice settings.
- Google X-ray sourcing from a selected job's title, location, active requirements, and aliases; recruiters save individual LinkedIn profile URLs, open each profile, paste job-related evidence, and compare profiles using scored criteria and evidence coverage.
- Poster Studio with editable templates and export sizes, saved history, PNG/PDF export, optional model-generated recruitment copy, and optional model-generated poster artwork. AI results remain editable and require recruiter review.
- Contact-minimized client submissions and a restricted reviewer role, interview scheduling and feedback, recruiter tasks, placement fees, invoice and payment status, replacement tracking, CSV reports, executive reports, privacy requests, and audit history.
- Public careers listings, candidate applications with consent recording, private resume storage, candidate access-key self-service, privacy requests, and an employer inquiry queue. Set the public workspace IDs to enable these routes.

## Architecture

| Part | Technology | Responsibility |
| --- | --- | --- |
| `apps/web` | Next.js App Router, React, TypeScript | Internal workspace, authentication screens, poster tools, careers pages |
| `apps/api` | FastAPI, Pydantic, PyMongo | Authentication, authorization, ATS workflows, parsing, scoring, reports, optional AI |
| Database | MongoDB Atlas or self-hosted MongoDB | Users, workspace records, applications, audit data, invitations, and portal records |
| Private file storage | MongoDB GridFS | Resumes and job-description files; downloads use signed short-lived links |
| AI providers | OpenAI API, optional | Structured resume facts, job poster copy, and poster artwork |

Mongo collections are workspace-scoped with `org_id` and indexed lookup fields. The API checks membership and roles before returning workspace data. The older SQL migration files under `supabase/migrations` are retained as historical artifacts; the current app does not apply or query them.

### Security notes

- Passwords are stored as salted scrypt hashes. Auth JWTs are stored in HTTP-only cookies; production cookies require HTTPS.
- Set a new random `JWT_SECRET` with at least 32 characters. Never expose MongoDB, Google, or OpenAI secrets through `NEXT_PUBLIC_*` variables.
- Resume files are not placed in a public bucket. Signed download links expire after one minute.
- Team invite tokens and candidate access keys are stored as hashes. Team invitation links expire after seven days; candidate portal keys expire after one year.
- Candidate duplicate matches are warnings. Profiles are not merged automatically.
- X-ray sourcing stores only profile URLs and evidence a recruiter explicitly pastes into the workspace. It does not scrape, crawl, or automate LinkedIn. Use job-related information and follow candidate notice and privacy requirements.
- OpenAI poster generation does not publish content. Recruiters review generated copy and artwork before exporting or sharing it.
- Review applicable privacy, employment, retention, and candidate-notice requirements with qualified counsel before production use. The product is not a legal certification.

## Requirements

- Node.js 22 LTS and pnpm 10.
- Python 3.12 for the documented API container.
- MongoDB Atlas (recommended) or a local MongoDB deployment.
- Optional Google OAuth application for Google account sign-in/linking.
- Optional OpenAI API key for AI resume extraction, poster copy, and poster artwork.

## Local setup

### 1. Start MongoDB

For local development with Docker:

```powershell
docker compose up -d mongodb
```

The compose file uses a development-only username/password. Do not reuse them outside a developer machine.

Or create a MongoDB Atlas cluster and copy its connection string. Add the development machine's IP to the Atlas network access list and create a database user with least-privilege access to the RecruitOS database.

### 2. Configure environment

Copy the examples:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

Set these values in `apps/api/.env`:

- `MONGODB_URI` and `MONGODB_DATABASE` for your MongoDB cluster.
- `JWT_SECRET` to a random secret of at least 32 characters.
- `APP_WEB_URL`, `API_PUBLIC_URL`, and `ALLOWED_ORIGINS` to the exact local or deployed frontend/API origins.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` if you want Google sign-in. In Google Cloud Console, register the callback URL exactly as `GOOGLE_REDIRECT_URI`.
- `OPENAI_API_KEY` and model names if you want AI features. The `.env.example` key value is only a placeholder.
- `PUBLIC_CAREERS_ORG_ID` and optionally `PUBLIC_EMPLOYER_LEADS_ORG_ID` after creating a workspace, if you want public careers and employer leads.

Set `NEXT_PUBLIC_API_BASE_URL` in `apps/web/.env.local` to the API's `/api/v1` URL. This value is public and contains no secret.

To use the included local Docker MongoDB, the API URI is:

```text
mongodb://recruitos:change-this-local-only@localhost:27017/?authSource=admin
```

### 3. Install dependencies

From the repository root:

```powershell
pnpm install
```

In a second terminal:

```powershell
Set-Location apps/api
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Run the app

Start the Python API from `apps/api`:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the web app from the repository root:

```powershell
pnpm --filter web dev
```

Open [http://localhost:3000](http://localhost:3000). The API health endpoint is [http://localhost:8000/health](http://localhost:8000/health). Development API documentation is at [http://localhost:8000/docs](http://localhost:8000/docs).

Create the first account, create a workspace, invite teammates from **Workspace settings**, and add clients and jobs. Invitation links must be copied and shared with the invited email address. For demo mode with no MongoDB configured, use `demo@mosahay.com` / `RecruitOSDemo2026!`; demo accounts and edits are local to that browser.

## Google OAuth setup

Create a Google OAuth Web application and add this authorized redirect URI:

```text
https://YOUR_API_HOST/api/v1/auth/google/callback
```

For local development use `http://localhost:8000/api/v1/auth/google/callback`. Set the matching client ID, secret, redirect URI, and frontend URL in the API environment. Configure production frontend and API on the same site, for example `app.example.com` and `api.example.com`, and set `AUTH_COOKIE_DOMAIN=.example.com`, `APP_WEB_URL`, `API_PUBLIC_URL`, and `ALLOWED_ORIGINS` to those exact hosts. Cross-site cookies may be blocked by browsers when frontend and API use unrelated hosting domains.

When Google returns a verified email already registered with RecruitOS, it links Google to that account. Signed-in users can also link Google from **Workspace settings → Connected accounts**. Email/password signup works without Google.

## Google X-ray sourcing

Open **X-Ray sourcing**, choose a job, and generate Google search strings from its title, location, active criteria, and aliases. Search Google, paste one LinkedIn `/in/` profile URL per line, and open each profile from the saved list. Paste only job-related work history and skills into the evidence field to compare profiles against the job rubric. Scores include criterion evidence and coverage; incomplete evidence lowers confidence and recruiters make every decision.

RecruitOS does not automatically open, fetch, or scrape LinkedIn profile pages. LinkedIn says automated scraping is prohibited in its [User Agreement](https://www.linkedin.com/legal/user-agreement), and its [Profile API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api) restricts access to other members' profiles and profile data storage. The X-ray workflow requires no LinkedIn API credentials; recruiters review the profiles themselves and paste permitted job-related evidence.

## OpenAI setup

Set `OPENAI_API_KEY` on the Python API service only. Suggested variables:

```text
OPENAI_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-2.5-flare
AI_SCORING_ENABLED=false
```

The text model is used for structured resume facts and poster copy. The image model creates background artwork for posters. AI resume extraction remains off until the server toggle is enabled and a workspace owner configures the active candidate notice. Candidate scoring remains deterministic and evidence-based.

## Deployment

### MongoDB Atlas

For a $0 pilot, an Atlas Free cluster can hold the app database. Create a database user with read/write access only to `mosahay_recruitos`, then copy the Atlas connection string into the API host's secret manager. Set `MONGODB_DATABASE=mosahay_recruitos`.

Atlas Free clusters have a 512 MB storage limit and do not support managed backups. Use a manual `mongodump`/`mongorestore` backup if you pilot with disposable data. For real candidate records, use a paid tier with backups and a tested restore process. [Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) · [Atlas backup comparison](https://www.mongodb.com/docs/atlas/manage-clusters/).

### Free pilot deployment on Render

The repository includes an API Blueprint in `render.yaml`. The Next.js app can run as a second Render web service. The optional `API_PROXY_ORIGIN` rewrite sends `/api/v1/*` through the frontend origin, so the browser sees one host for the app, session cookie, uploads, and Google callback. Keep `AUTH_COOKIE_DOMAIN` empty for this setup.

Render's free web services spin down after 15 minutes idle and can take about a minute to wake. Render says free instances are for previewing and should not be used for production. Atlas Free has no managed backups. Treat this as a functional pilot with synthetic data, not a safe home for real resumes, contact details, or hiring decisions. [Render free service limits](https://render.com/docs/free).

1. Push this project to a private GitHub repository. Confirm `.env`, `.env.local`, and secrets are not committed.

2. In MongoDB Atlas, create a Free cluster, a database user for `mosahay_recruitos`, and copy its `mongodb+srv://` connection string. Do not put the username/password in Git. For network access, after creating the Render API service, copy its outbound CIDR ranges from Render's **Connect → Outbound** panel into Atlas **Network Access**. Use the API service's Render region. Avoid `0.0.0.0/0`; Atlas warns that this opens the cluster to connections from anywhere. [Atlas IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/) · [Render outbound IPs](https://render.com/docs/outbound-ip-addresses).

3. In Render, choose **New → Blueprint**, connect the repository, and deploy the root `render.yaml`. For prompted `sync: false` variables, provide the Atlas URI for `MONGODB_URI`; use `https://placeholder.invalid` for `APP_WEB_URL`, `API_PUBLIC_URL`, and `ALLOWED_ORIGINS` until you have the frontend URL. Keep `AUTH_COOKIE_DOMAIN` blank. Leave optional Google, OpenAI, and public workspace values blank if you are not using them yet. Render generates `JWT_SECRET`. The API health check is `/health`.

4. In Render, create a second **Web Service** from the same repository for Next.js:

   - Root directory: repository root (leave blank).
   - Runtime: Node.
   - Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter web build`
   - Start command: `pnpm --filter web start`
   - Environment: `NEXT_PUBLIC_API_BASE_URL=/api/v1`, `API_PROXY_ORIGIN=https://YOUR-API-SERVICE.onrender.com`, and `NEXT_PUBLIC_APP_URL=https://YOUR-WEB-SERVICE.onrender.com`.

   Set `API_PROXY_ORIGIN` to the API's host with no `/api/v1` suffix. Redeploy the web service after changing it because Next.js records rewrites during its build.

5. Copy the web service's exact HTTPS origin (scheme + host, no trailing slash) into the API service's `APP_WEB_URL`, `API_PUBLIC_URL`, and `ALLOWED_ORIGINS`. For example, use `https://mosahay-recruitos-web.onrender.com` in all three. Keep `AUTH_COOKIE_DOMAIN` blank. Set `APP_ENV=production`, save, and redeploy the API. This makes invite links and temporary resume download links use the frontend proxy as well.

6. Open the web URL, create the first owner account, and create the workspace. Do this before sharing the URL; the initial deployment has public sign-up enabled so the first owner can be created.

7. As soon as the owner and workspace exist, set `ALLOW_PUBLIC_SIGNUP=false` on the API and redeploy. The sign-up option disappears for visitors without an invite; invitation sign-up continues to work. Then invite teammates from **Workspace settings**. Invitation email delivery is not configured: copy each generated invite link and send it to the matching work email yourself. Invitations are tied to the invited address. New Google identities also need an invited account first, then the teammate can link Google from **Workspace settings → Connected accounts**.

8. Confirm `/health` reports `"database":"mongodb"`; then verify sign-in, sign-out, invite acceptance, workspace isolation, candidate uploads/downloads, and the X-Ray workflow with synthetic data. Do not upload live candidate information to the free pilot.

### Google OAuth

Google sign-in and account linking are optional. Create a Google OAuth Web application. For Google Workspace, set the OAuth audience to **Internal** when available so only accounts in that Workspace organization can authenticate. Add this exact authorized redirect URI, replacing the host with the frontend service's real URL:

```text
https://YOUR-WEB-SERVICE.onrender.com/api/v1/auth/google/callback
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` on the API service. The URI must exactly match the Google Console value, including scheme, host, path, and trailing slash. [Google OAuth web server setup](https://developers.google.com/identity/protocols/oauth2/web-server) · [Google internal-only apps](https://support.google.com/cloud/answer/13463817).

### AI features and spend

Leave `OPENAI_API_KEY` blank and `AI_SCORING_ENABLED=false` for a no-cost pilot; AI features that need a model key will not be available. If enabled later, add the API key only to the Python API service's secret environment, never to the browser or Git. OpenAI API usage is billed separately from ChatGPT subscriptions. [OpenAI billing details](https://help.openai.com/en/articles/9039756-managing-your-work-in-the-api-platform-with-projects).

### When your team is ready for real hiring data

Move both Render services to paid instances, move Atlas to a tier with backups, set a recurring backup/restore process, and use a domain controlled by your organization. Vercel Hobby is not a fit for this internal business app because its terms limit that plan to personal or non-commercial use. [Vercel Hobby terms](https://vercel.com/legal/terms) · [Vercel Hobby plan](https://vercel.com/docs/plans/hobby).

## Data collections

Workspace data is stored in collections such as `organizations`, `organization_members`, `team_invitations`, `clients`, `jobs`, `job_requirements`, `candidates`, `applications`, `resume_assets`, `candidate_submissions`, `job_reviewer_assignments`, `interviews`, `interview_scorecards`, `recruiter_tasks`, `placements`, `replacement_records`, `job_posters`, `privacy_requests`, `activity_events`, and `audit_logs`. Auth data is in `users` and `auth_oauth_states`; GridFS uses the `candidate_resumes` bucket. Indexes are created at API startup.

Public careers and candidate portal records use the same MongoDB database. Set the public workspace environment variables explicitly so the careers routes only expose the intended workspace.

## Checks

From the repository root:

```powershell
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
```

From `apps/api` with the Python environment active:

```powershell
python -m pytest -q
```

## Troubleshooting

- **MongoDB not configured:** set `MONGODB_URI`, `MONGODB_DATABASE`, and `JWT_SECRET` on the API service, then restart it.
- **MongoDB connection timeout:** verify Atlas network access, database username/password URL encoding, TLS, and the cluster hostname.
- **Browser CORS or login loop:** set the exact frontend origin in `ALLOWED_ORIGINS`; use the same site for the frontend/API in production and configure HTTPS plus `AUTH_COOKIE_DOMAIN`.
- **Google sign-in/link is disabled:** set a real Google client ID and secret on the API and restart the service. Placeholder values are ignored.
- **Google redirect error:** the Google Console callback URI must exactly match `GOOGLE_REDIRECT_URI`.
- **AI tools are unavailable:** add a valid backend-only `OPENAI_API_KEY` and a model available to the account. Placeholder values are intentionally rejected.
- **Public careers are empty:** set `PUBLIC_CAREERS_ORG_ID`, create an open role, link the current privacy notice, and publish the role from the workspace.
- **Resume parse needs review:** scanned/image-only files need manual review; OCR is not included.

The master ATS template is intentionally retained for reference. Some future integrations such as email/WhatsApp delivery, calendar sync, OCR, broad automation rules, and a contextual AI assistant are not included in this release and are not shown as connected.
