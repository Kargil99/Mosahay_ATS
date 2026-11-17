# Scicom Recruit ATS

Scicom Recruit is a recruitment-agency Applicant Tracking System (ATS) for managing clients, job descriptions, candidate CVs, job-specific evidence matching, recruiter review, hiring pipelines, structured interview scorecards, and audit history.

**Important:** Candidate scores are review aids, not automated hiring decisions. The application must not automatically reject or hide candidates based on scores. Review source evidence and make hiring decisions through an authorized human recruiter.

## Architecture

- `apps/web`: Next.js App Router + TypeScript frontend, deployed to Vercel.
- `apps/api`: FastAPI backend for parsing, matching, and ATS APIs, deployed to Render.
- Supabase: Auth, PostgreSQL, Row Level Security (RLS), and private Storage.
- Optional AI extraction: OpenAI API called only from the backend when configured and enabled.

## Requirements

Install the following before starting:

- Node.js 22 LTS or a compatible supported LTS release
- pnpm (the repo's `packageManager` field specifies the intended version)
- Python 3.12
- Git
- A Supabase project for Auth, PostgreSQL, and Storage
- Optional: an OpenAI API key for AI-assisted JD/CV extraction
- Optional for local Supabase: Docker and the Supabase CLI

The exact versions in `package.json`, `pnpm-lock.yaml`, and `apps/api/requirements.txt` are the source of truth for this repository.

## Repository layout

```text
apps/web/             Next.js frontend
apps/api/             FastAPI backend
supabase/migrations/  Version-controlled SQL migrations, RLS and Storage policies
README.md             Setup and deployment instructions
```

## 1. Configure Supabase

1. Create a project in the Supabase dashboard. Use a development project first; do not test migrations with real candidate data.
2. From **Project Settings → API**, copy the project URL and publishable/anon key. Use the current key label shown by your Supabase project; the environment variable name in this README remains `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the generated app unless the code explicitly supports a newer publishable-key variable.
3. In the project settings, configure Auth site URL and redirect URLs for local development (`http://localhost:3000`) and the deployed frontend URL. Enable the email/password provider required by the app.
4. Apply the versioned database migrations from the repository root as described below. Migrations must create all tables, indexes, RLS policies, helper functions, and the private CV Storage bucket/policies. Do not manually disable RLS to make the app work.
5. Confirm the CV bucket is private. The browser must not be able to fetch a CV just by guessing its storage path.

### Apply migrations with the Supabase CLI

From the repository root:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_SUPABASE_PROJECT_REF
npx supabase@latest db push
```

Replace `YOUR_SUPABASE_PROJECT_REF` with the project reference displayed in Supabase. Review the generated SQL before applying it to a production project. For local development, you may instead use the Supabase CLI's local stack; this requires Docker. Use a separate test project for automated integration tests.

## 2. Configure environment variables

Copy the example files:

- `apps/web/.env.example` → `apps/web/.env.local`
- `apps/api/.env.example` → `apps/api/.env`

Fill in real values locally. Never commit `.env`, `.env.local`, API keys, access tokens, or candidate CVs.

### Frontend: `apps/web/.env.local`

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

Only public project configuration belongs in `NEXT_PUBLIC_*` variables. **Never put `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or `OPENAI_API_KEY` in a frontend environment variable.** The intended default architecture does not require a service-role key.

### Backend: `apps/api/.env`

```dotenv
APP_ENV=development
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
ALLOWED_ORIGINS=http://localhost:3000
MAX_UPLOAD_MB=10
MAX_FILES_PER_BATCH=20
AI_SCORING_ENABLED=false
OPENAI_API_KEY=
OPENAI_MODEL=
```

- `SUPABASE_URL`: same project URL as the frontend.
- `SUPABASE_ANON_KEY`: public/publishable key; database and storage calls must also carry the authenticated user's access token so RLS is applied.
- `ALLOWED_ORIGINS`: comma-separated exact origins, without a trailing slash, that may call the API.
- `MAX_UPLOAD_MB`: maximum size per CV file; default `10`.
- `MAX_FILES_PER_BATCH`: maximum number of uploaded files per request; default `20`.
- `AI_SCORING_ENABLED`: set to `true` only after configuring an available model, reviewing the candidate privacy notice, and enabling the feature for the workspace. The UI must clearly label non-AI fallback mode.
- `OPENAI_API_KEY`: optional backend-only key.
- `OPENAI_MODEL`: set to a model currently available to your API account. Do not assume a model name is available in every account or indefinitely.

If the implemented `.env.example` uses additional variables, document them there and here. Missing required variables should cause a clear startup error without printing their secret values.

## 3. Run locally

### Install frontend dependencies

From the repository root:

```bash
pnpm install
```

If the generated monorepo uses different package scripts, use the actual scripts in the root and `apps/web/package.json`; do not run commands from an arbitrary directory.

### Set up the Python API

**macOS/Linux** (from the repository root):

```bash
cd apps/api
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**Windows PowerShell** (from the repository root):

```powershell
cd apps/api
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Copy and fill `apps/api/.env` before running the API.

### Start the API

In terminal 1, from `apps/api` with the virtual environment activated:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check the health endpoint at `http://localhost:8000/health`. API documentation should be available at `http://localhost:8000/docs` in development only. The health response must not reveal secrets or private project configuration.

### Start the frontend

In terminal 2, from the repository root:

```bash
pnpm --filter web dev
```

Open `http://localhost:3000`. Sign up, create a workspace, create a client and job, review the extracted criteria, then upload synthetic/test CVs. If Supabase email confirmation is enabled, complete confirmation before signing in.

## 4. Tests and production build

Run commands from the repository root unless noted:

```bash
# Frontend lint, type check, tests and production build
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build

# Backend tests
cd apps/api
source .venv/bin/activate   # macOS/Linux; use the PowerShell activation command on Windows
python -m pytest -q
```

Use a dedicated test Supabase project or local Supabase instance for integration tests. Never run destructive tests against production candidate data. Backend tests should cover scoring formulas, missing evidence, invalid files, evidence validation, prompt-injection content, unauthenticated access, role permissions, cross-workspace access attempts, audit events, and score overrides.

## 5. Deploy the frontend to Vercel

1. Push the repository to GitHub.
2. In Vercel, create a project and import the repository.
3. Configure the project for the `apps/web` Next.js app. If prompted, enable inclusion of files outside the root directory so the monorepo lockfile and workspace configuration remain available. Use the generated app's documented workspace build settings; a common monorepo setup is root directory `apps/web`, install command `pnpm install --frozen-lockfile`, and build command `pnpm --filter web build`.
4. Add these environment variables in Vercel for **Preview** and **Production** as appropriate:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_API_BASE_URL` = the deployed Render API URL plus `/api/v1`, for example `https://YOUR-API.onrender.com/api/v1`
5. Deploy. Test the deployed sign-in flow and browser-to-API requests. Do not expose backend-only secrets as `NEXT_PUBLIC_*` variables.
6. Add the final Vercel URL to Supabase Auth's site URL/redirect allowlist and to the backend's `ALLOWED_ORIGINS`.

Vercel's dashboard labels can change; follow current Vercel documentation if its monorepo fields differ. Do not mark deployment complete until the actual deployed build succeeds.

## 6. Deploy the backend to Render

1. In Render, create a **New → Web Service** from the GitHub repository.
2. Set the root directory to `apps/api` if Render's monorepo configuration supports it.
3. Set runtime to Python. Use build command:

   ```bash
   pip install -r requirements.txt
   ```

4. Use start command:

   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```

5. Set the health check path to `/health`.
6. Add the backend environment variables from the previous section, changing `APP_ENV=production`, setting `ALLOWED_ORIGINS` to the exact deployed frontend origin, and enabling AI only after the privacy/configuration checks. Store `OPENAI_API_KEY` only in Render's environment/secrets settings.
7. Deploy, then verify `https://YOUR-API.onrender.com/health` returns a healthy, non-sensitive response.
8. Set the frontend `NEXT_PUBLIC_API_BASE_URL` to `https://YOUR-API.onrender.com/api/v1`, redeploy the frontend, and verify API requests from the live site.
9. Configure a custom API domain only after the default URL works. Keep CORS restricted to the production frontend and any approved preview URLs; avoid wildcard origins when credentials are used.

Render free-tier services may sleep or have resource limits. Verify the current plan limits before relying on it for production recruitment workflows.

## 7. Manual end-to-end smoke test

Use synthetic CVs and a test workspace:

1. Sign up and confirm the email if required.
2. Create a workspace and verify that the first user is the owner.
3. Create a client and a job by pasting a JD.
4. Review the extracted job fields and edit the requirement weights to total 100.
5. Upload two or three synthetic PDF/DOCX CVs.
6. Confirm per-file parse status, manual-review warnings, and duplicate warnings work.
7. Run matching and confirm that each criterion shows a state, evidence and weight; `not_evidenced` must not be shown as proof of missing ability.
8. Confirm score and evidence coverage are distinct, and that all-unknown criteria produce `Insufficient evidence`, not a fake zero score.
9. Open every candidate and the private resume URL; confirm unauthorized users cannot access it.
10. Move one application through pipeline stages, add a note, submit a scorecard, and confirm the activity log updates.
11. Create a manual score override with a required reason; confirm the original score run remains intact.
12. Export only the authorized workspace's records.
13. Test another user/workspace and verify no cross-workspace candidate, job, score, note, export or CV can be accessed.
14. Submit a privacy/deletion request and verify that it is auditable.

## 8. Production privacy and security checklist

Before uploading real candidate data:

- Review applicable Indian data-protection requirements, employment rules, and any client-country laws with qualified counsel. The system is not a legal-compliance certification.
- Publish a clear candidate privacy notice and explain sharing with recruitment clients and optional AI-provider processing.
- Decide and document the appropriate lawful basis/consent workflow, retention periods, deletion process, candidate request handling, and client contracts.
- Start with AI processing disabled until the notice, provider, and settings have been reviewed.
- Confirm RLS on every private table, Storage policies on every file path, and workspace/role checks on every API route.
- Confirm backups, restore procedures, logging policy, rate limits, dependency updates, and error reporting.
- Confirm uploaded resumes are never publicly accessible and that API/frontend logs do not contain raw CV text, contact data, tokens, or private signed URLs.
- Validate that scoring is job-related and explainable, candidates with insufficient CV evidence are routed for review, and no candidate is automatically rejected by a score.
- Run authorization tests against the production-like configuration with synthetic data before onboarding recruiters.

## Troubleshooting

- **Frontend cannot call API:** confirm `NEXT_PUBLIC_API_BASE_URL`, the deployed Render URL, API health, and `ALLOWED_ORIGINS`; then redeploy after changing environment variables.
- **Supabase sign-in works but API returns 401:** confirm the frontend sends the current Supabase access token as `Authorization: Bearer <token>`, the backend uses the expected Supabase project URL/key, and token validation is not swallowing errors.
- **Queries return empty or 403:** inspect RLS policies, verify membership creation and role assignment, and ensure each request uses the user's access token. Do not “fix” this by making all tables public or turning RLS off.
- **CV upload returns 403:** verify that the private Storage bucket exists and its RLS policies permit the authenticated workspace member to write only to that workspace's path.
- **CV extraction is empty:** the PDF may be scanned/image-only or malformed. Keep it in manual review; do not invent extracted fields. OCR is optional and must be configured separately.
- **AI extraction is unavailable:** check `AI_SCORING_ENABLED`, backend-only `OPENAI_API_KEY`, `OPENAI_MODEL` availability, provider quota and server logs. The app should return a visible error or use its clearly labelled rules-based fallback.
- **Migrations fail:** review the failed migration, Supabase CLI project link, schema dependencies, and migration order. Never reset a production database to resolve a migration problem.

## Documentation and legal note

This README is the setup guide, not legal advice. Product functionality, current provider behavior, hosting limits, and applicable law can change; recheck official documentation before a production release.
