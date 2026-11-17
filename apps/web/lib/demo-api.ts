type AnyRow = Record<string, any>;

const STORE_KEY = "mosahay-recruitos-demo-data-v1";
const ORG_ID = "demo-org-mosahay";
const USER_ID = "demo-user-owner";
const now = () => new Date().toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const id = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 12)}`;

function seed(): AnyRow {
  const clients = [
    { id: "client-northstar", org_id: ORG_ID, name: "Northstar Health Systems", website: "northstarhealth.example", industry: "Healthcare", created_at: daysAgo(54) },
    { id: "client-bluepeak", org_id: ORG_ID, name: "BluePeak Logistics", website: "bluepeak.example", industry: "Logistics", created_at: daysAgo(42) },
    { id: "client-saffron", org_id: ORG_ID, name: "SaffronPay Technologies", website: "saffronpay.example", industry: "Financial technology", created_at: daysAgo(30) },
  ];
  const members = [
    { id: USER_ID, user_id: USER_ID, role: "owner", created_at: daysAgo(90) },
    { id: "demo-user-recruiter", user_id: "demo-user-recruiter", role: "recruiter", created_at: daysAgo(42) },
    { id: "demo-user-sourcer", user_id: "demo-user-sourcer", role: "sourcer", created_at: daysAgo(35) },
    { id: "demo-user-reviewer", user_id: "demo-user-reviewer", role: "reviewer", created_at: daysAgo(20) },
  ];
  const candidates = [
    { id: "candidate-ananya", org_id: ORG_ID, full_name: "Ananya Rao", email: "ananya.rao@example.test", phone: "+91 98765 43210", current_title: "Product Analyst", current_employer: "Cedar Labs", skills: ["SQL", "Product Analytics", "A/B Testing", "Tableau"], source: "referral", parse_status: "parsed", consent_status: "recorded", privacy_notice_version: "2026-01", created_at: daysAgo(24), parsed_profile: { approximate_experience_years: 5.2, experiences: [{ title: "Product Analyst", employer: "Cedar Labs", start_date: "2022-01-01", is_current: true, evidence_quote: "Product Analyst at Cedar Labs · Jan 2022 – Present" }], educations: [{ evidence_quote: "MSc, Business Analytics · University of Pune" }], certifications: ["Google Analytics"] } },
    { id: "candidate-rohan", org_id: ORG_ID, full_name: "Rohan Mehta", email: "rohan.mehta@example.test", phone: "+91 99887 76655", current_title: "Talent Acquisition Lead", current_employer: "CloudMint", skills: ["Recruitment", "Stakeholder Management", "ATS", "Sourcing"], source: "linkedin", parse_status: "parsed", consent_status: "recorded", created_at: daysAgo(19), parsed_profile: { approximate_experience_years: 8, experiences: [{ title: "Talent Acquisition Lead", employer: "CloudMint", start_date: "2020-03-01", is_current: true, evidence_quote: "Talent Acquisition Lead at CloudMint · Mar 2020 – Present" }], educations: [{ evidence_quote: "MBA, Human Resources · Symbiosis" }] } },
    { id: "candidate-priya", org_id: ORG_ID, full_name: "Priya Nair", email: "priya.nair@example.test", phone: "+91 91234 56780", current_title: "Operations Manager", current_employer: "ParcelWorks", skills: ["Operations", "Team Leadership", "Process Improvement", "Excel"], source: "job_board", parse_status: "parsed", consent_status: "recorded", created_at: daysAgo(16), parsed_profile: { approximate_experience_years: 7.5, experiences: [{ title: "Operations Manager", employer: "ParcelWorks", start_date: "2021-05-01", is_current: true, evidence_quote: "Operations Manager at ParcelWorks · May 2021 – Present" }], educations: [{ evidence_quote: "BCom · University of Kerala" }] } },
    { id: "candidate-kabir", org_id: ORG_ID, full_name: "Kabir Shah", email: "kabir.shah@example.test", phone: "+91 90000 11223", current_title: "Data Analyst", current_employer: "SaffronPay", skills: ["Python", "SQL", "Power BI", "Experimentation"], source: "direct_application", parse_status: "parsed", consent_status: "recorded", created_at: daysAgo(12), parsed_profile: { approximate_experience_years: 3.4, experiences: [{ title: "Data Analyst", employer: "SaffronPay", start_date: "2023-02-01", is_current: true, evidence_quote: "Data Analyst at SaffronPay · Feb 2023 – Present" }], educations: [{ evidence_quote: "BTech, Information Technology · NIT Surat" }] } },
    { id: "candidate-meera", org_id: ORG_ID, full_name: "Meera Iyer", email: "meera.iyer@example.test", phone: "+91 90123 45678", current_title: "HR Business Partner", current_employer: "Northstar Health Systems", skills: ["Employee Relations", "HR Operations", "Workforce Planning"], source: "referral", parse_status: "needs_manual_review", consent_status: "not_recorded", created_at: daysAgo(8), parsed_profile: { approximate_experience_years: null, experiences: [], educations: [] } },
    { id: "candidate-dev", org_id: ORG_ID, full_name: "Dev Malhotra", email: "dev.malhotra@example.test", phone: "+91 98989 12345", current_title: "Senior Backend Engineer", current_employer: "OrbitStack", skills: ["Python", "FastAPI", "PostgreSQL", "AWS"], source: "sourcer", parse_status: "parsed", consent_status: "recorded", created_at: daysAgo(4), parsed_profile: { approximate_experience_years: 6.1, experiences: [{ title: "Senior Backend Engineer", employer: "OrbitStack", start_date: "2020-01-01", is_current: true, evidence_quote: "Senior Backend Engineer at OrbitStack · Jan 2020 – Present" }], educations: [{ evidence_quote: "MTech, Computer Science · IIIT Hyderabad" }] } },
  ];
  const clientsById = Object.fromEntries(clients.map(row => [row.id, row]));
  const reqs = (items: string[]) => items.map((criterion, index) => ({ id: `req-${index + 1}`, criterion, description: `${criterion} relevant to the confirmed role`, required: index < 3, weight: [35, 25, 20, 10, 10][index], aliases: [], active: true }));
  const jobs = [
    { id: "job-product-analyst", org_id: ORG_ID, client_id: clients[2].id, title: "Senior Product Analyst", status: "open", description: "Own product analytics, experimentation, and decision support. Partner with product managers to define metrics and evaluate experiments.", location: "Bengaluru, India", work_arrangement: "hybrid", employment_type: "full_time", salary_min: 1800000, salary_max: 2600000, salary_currency: "INR", vacancies: 1, experience_min: 4, experience_max: 8, industry: "Financial technology", department: "Product", created_at: daysAgo(36), application_deadline: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10), requirements: reqs(["SQL and data analysis", "Product analytics experience", "Experiment design", "Dashboarding", "Stakeholder communication"]) },
    { id: "job-ta-lead", org_id: ORG_ID, client_id: clients[0].id, title: "Talent Acquisition Lead", status: "open", description: "Lead full-cycle hiring for clinical operations and technology teams. Build sourcing plans, coach recruiters, and partner with hiring leaders.", location: "Pune, India", work_arrangement: "hybrid", employment_type: "full_time", salary_min: 2200000, salary_max: 3000000, salary_currency: "INR", vacancies: 1, experience_min: 7, experience_max: 12, industry: "Healthcare", department: "People", created_at: daysAgo(21), application_deadline: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10), requirements: reqs(["Full-cycle recruiting", "Team leadership", "Healthcare hiring", "ATS fluency", "Stakeholder partnership"]) },
    { id: "job-ops-manager", org_id: ORG_ID, client_id: clients[1].id, title: "Regional Operations Manager", status: "draft", description: "Manage regional logistics operations, service levels, and continuous improvement.", location: "Mumbai, India", work_arrangement: "on_site", employment_type: "full_time", salary_currency: "INR", vacancies: 2, experience_min: 5, experience_max: 10, industry: "Logistics", department: "Operations", created_at: daysAgo(7), requirements: reqs(["Operations leadership", "Process improvement", "Logistics experience", "Data reporting", "People management"]) },
  ];
  const applications = [
    { id: "application-ananya", org_id: ORG_ID, candidate_id: candidates[0].id, job_id: jobs[0].id, owner_id: members[1].user_id, stage: "Interview", status: "active", created_at: daysAgo(15), latest_score: { total_score: 86, evidence_coverage: 92, confidence: "high", created_at: daysAgo(2) } },
    { id: "application-kabir", org_id: ORG_ID, candidate_id: candidates[3].id, job_id: jobs[0].id, owner_id: members[1].user_id, stage: "Shortlisted", status: "active", created_at: daysAgo(10), latest_score: { total_score: 79, evidence_coverage: 84, confidence: "medium", created_at: daysAgo(3) } },
    { id: "application-dev", org_id: ORG_ID, candidate_id: candidates[5].id, job_id: jobs[0].id, owner_id: members[2].user_id, stage: "Needs Review", status: "active", created_at: daysAgo(3), latest_score: null },
    { id: "application-rohan", org_id: ORG_ID, candidate_id: candidates[1].id, job_id: jobs[1].id, owner_id: members[1].user_id, stage: "Submitted to Client", status: "active", created_at: daysAgo(6), latest_score: { total_score: 82, evidence_coverage: 88, confidence: "high", created_at: daysAgo(4) } },
    { id: "application-meera", org_id: ORG_ID, candidate_id: candidates[4].id, job_id: jobs[1].id, owner_id: members[2].user_id, stage: "New", status: "active", created_at: daysAgo(1), latest_score: null },
    { id: "application-priya", org_id: ORG_ID, candidate_id: candidates[2].id, job_id: jobs[2].id, owner_id: members[1].user_id, stage: "Recruiter Screen", status: "active", created_at: daysAgo(5), latest_score: { total_score: 74, evidence_coverage: 80, confidence: "medium", created_at: daysAgo(1) } },
  ];
  const activity = [
    { id: "activity-1", action: "candidate_submitted_to_client", entity_type: "application", created_at: daysAgo(1) },
    { id: "activity-2", action: "interview_scheduled", entity_type: "interview", created_at: daysAgo(2) },
    { id: "activity-3", action: "candidate_scored", entity_type: "application", created_at: daysAgo(3) },
    { id: "activity-4", action: "job_created", entity_type: "job", created_at: daysAgo(7) },
    { id: "activity-5", action: "candidate_imported", entity_type: "candidate", created_at: daysAgo(8) },
  ];
  return {
    clients, members, candidates, jobs, applications, activity, leads: [
      { id: "lead-1", org_id: ORG_ID, company_name: "Asterion Mobility", contact_name: "Nisha Kapoor", email: "nisha@asterion.example", phone: "+91 98700 11223", job_title: "Plant HR Manager", vacancies: 2, required_skills: ["HR", "Manufacturing"], location: "Chennai", hiring_timeline: "This month", status: "qualified", created_at: daysAgo(2) },
    ], tasks: [
      { id: "task-1", org_id: ORG_ID, title: "Confirm interview panel availability", description: "Product Analyst final round", status: "open", priority: "high", due_at: new Date(Date.now() + 86400000).toISOString(), assigned_to: members[1].user_id, job_id: jobs[0].id, candidates: candidates[0], jobs: { title: jobs[0].title }, created_at: daysAgo(1) },
      { id: "task-2", org_id: ORG_ID, title: "Follow up on client feedback", description: "Talent Acquisition Lead shortlist", status: "in_progress", priority: "normal", due_at: daysAgo(1), assigned_to: members[1].user_id, job_id: jobs[1].id, candidates: candidates[1], jobs: { title: jobs[1].title }, created_at: daysAgo(3) },
    ], interviews: [
      { id: "interview-1", org_id: ORG_ID, application_id: applications[0].id, scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString(), duration_minutes: 60, mode: "video", status: "scheduled", meeting_link: "", candidates: candidates[0], jobs: { title: jobs[0].title }, clients: clientsById[jobs[0].client_id] },
    ], submissions: [], placements: [], posters: [], privacy_requests: [], audit_logs: [], notes: {}, scorecards: [], score_runs: {}, reviewers: {}, interview_questions: {}, crm: {}, xray_profiles: [],
  };
}

function load(): AnyRow {
  if (typeof window === "undefined") return seed();
  try {
    const value = window.localStorage.getItem(STORE_KEY);
    if (value) {
      const stored = JSON.parse(value);
      if (!Array.isArray(stored.xray_profiles)) stored.xray_profiles = [];
      return stored;
    }
  } catch { /* Start with a fresh demo dataset if local storage is unavailable. */ }
  const value = seed();
  save(value);
  return value;
}

function save(data: AnyRow) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function bodyValue(init: RequestInit): AnyRow {
  if (typeof init.body === "string") { try { return JSON.parse(init.body); } catch { return {}; } }
  return {};
}

function appRows(data: AnyRow, jobId?: string) {
  return data.applications.filter((row: AnyRow) => !jobId || row.job_id === jobId).map((row: AnyRow) => joinApplication(data, row));
}

function joinApplication(data: AnyRow, app: AnyRow): AnyRow {
  const job = data.jobs.find((item: AnyRow) => item.id === app.job_id);
  return { ...app, candidates: data.candidates.find((item: AnyRow) => item.id === app.candidate_id), jobs: job, clients: data.clients.find((item: AnyRow) => item.id === job?.client_id) };
}

function scoreDemoApplication(data: AnyRow, applicationId: string) {
  const app = data.applications.find((row: AnyRow) => row.id === applicationId);
  const candidate = data.candidates.find((row: AnyRow) => row.id === app?.candidate_id);
  const job = data.jobs.find((row: AnyRow) => row.id === app?.job_id);
  if (!app || !candidate || !job) return null;
  const matches = candidate.skills.filter((skill: string) => job.description.toLowerCase().includes(skill.toLowerCase()) || job.requirements.some((req: AnyRow) => req.criterion.toLowerCase().includes(skill.toLowerCase()))).length;
  const score = Math.min(96, 58 + matches * 8);
  const scoreRun = { application_id: app.id, total_score: score, evidence_coverage: 78, confidence: "medium", scoring_version: "demo-fixture-v1", rubric_version: 1, result: { match_score: score, evidence_coverage: 78, confidence: "medium", review_priority: "human_review", scoring_version: "demo-fixture-v1", rubric_version: 1, criteria: (job.requirements || []).map((req: AnyRow) => ({ criterion: req.criterion, weight: req.weight, state: "evidenced", rating: 3, explanation: "Illustrative demo evidence only. Review original resume evidence before any hiring decision.", evidence_quote: candidate.skills.slice(0, 2).join(", ") || null })) }, created_at: now() };
  app.latest_score = { total_score: score, evidence_coverage: 78, confidence: "medium", created_at: scoreRun.created_at };
  data.score_runs[app.id] = [scoreRun, ...(data.score_runs[app.id] || [])];
  return scoreRun;
}

function pipelineReport(data: AnyRow) {
  const by_stage: Record<string, number> = {};
  const source_counts: Record<string, number> = {};
  for (const row of data.applications) by_stage[row.stage] = (by_stage[row.stage] || 0) + 1;
  for (const row of data.candidates) source_counts[row.source || "unknown"] = (source_counts[row.source || "unknown"] || 0) + 1;
  return { total: data.applications.length, by_stage, source_counts, average_days_in_current_stage: {}, average_time_to_fill_days: 32, truncated: false };
}

function executiveReport(data: AnyRow) {
  const report = pipelineReport(data);
  const expected = data.placements.reduce((sum: number, row: AnyRow) => sum + Number(row.expected_fee || 0), 0);
  const tasks = data.tasks.filter((row: AnyRow) => !["completed", "cancelled"].includes(row.status));
  return {
    kpis: { active_clients: data.clients.length, active_requirements: data.jobs.filter((row: AnyRow) => row.status === "open").length, open_positions: data.jobs.filter((row: AnyRow) => row.status === "open").reduce((sum: number, row: AnyRow) => sum + Number(row.vacancies || 1), 0), candidate_count: data.candidates.length, candidates_screened: data.applications.filter((row: AnyRow) => row.latest_score).length, candidates_submitted: data.submissions.length, interviews_scheduled: data.interviews.length, offers_released: report.by_stage.Offer || 0, candidates_joined: report.by_stage.Hired || 0, successful_placements: data.placements.length, expected_placement_revenue: expected, collected_placement_revenue: 0, pending_client_payments: data.placements.length, partial_payment_records: 0 },
    monthly_performance: [], source_performance: report.source_counts, recruiter_performance: [], client_performance: [], conversion: { submission_to_interview_pct: null, interview_to_offer_pct: null, offer_to_joining_pct: null }, time_to_fill: { average_days: 32, median_days: 32, completed_hires: 0 }, tasks: { due_today: 0, overdue: tasks.filter((row: AnyRow) => row.due_at && row.due_at.slice(0, 10) < new Date().toISOString().slice(0, 10)).length, upcoming_interviews: data.interviews.length, today_items: [], overdue_items: tasks.filter((row: AnyRow) => row.due_at && row.due_at.slice(0, 10) < new Date().toISOString().slice(0, 10)), upcoming_interview_items: data.interviews.map((row: AnyRow) => ({ scheduled_at: row.scheduled_at, candidate_name: row.candidates?.full_name || "Candidate", job_title: row.jobs?.title || "Role" })), requirements_deadline_soon: [] }, truncated: false,
  };
}

function demoXrayQueries(job: AnyRow) {
  const title = `"${job.title}"`;
  const location = job.location ? ` "${job.location}"` : "";
  const requirements = (job.requirements || []).filter((item: AnyRow) => item.active !== false).sort((a: AnyRow, b: AnyRow) => Number(b.weight || 0) - Number(a.weight || 0));
  const core = requirements.filter((item: AnyRow) => item.required).slice(0, 3);
  const focused = ["site:linkedin.com/in", title, ...core.map((item: AnyRow) => `("${item.criterion}")`), location, "-jobs"].filter(Boolean).join(" ");
  const broaderTerms = requirements.slice(0, 8).map((item: AnyRow) => `"${item.criterion}"`).join(" OR ");
  const broad = ["site:linkedin.com/in", title, broaderTerms ? `(${broaderTerms})` : "", location, "-jobs"].filter(Boolean).join(" ");
  return [
    { label: "Role + must-have criteria", intent: "Narrow search for the role and its highest-priority criteria.", query: focused },
    { label: "Role + broader skill pool", intent: "Wider search that accepts a match to any listed criterion.", query: broad },
  ];
}

function scoreDemoXrayProfile(job: AnyRow, text: string) {
  const requirements = (job.requirements || []).filter((item: AnyRow) => item.active !== false);
  const totalWeight = requirements.reduce((sum: number, item: AnyRow) => sum + Number(item.weight || 0), 0);
  let assessedWeight = 0;
  let weighted = 0;
  const criteria = requirements.map((item: AnyRow) => {
    const terms = `${item.criterion} ${item.description || ""} ${(item.aliases || []).join(" ")}`.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) || [];
    const relevant = [...new Set(terms.filter((term: string) => !["and", "the", "with", "for", "from", "years", "experience"].includes(term.toLowerCase())))];
    const overlaps = relevant.filter((term: string) => text.toLowerCase().includes(term.toLowerCase()));
    const weight = Number(item.weight || 0);
    if (!overlaps.length) return { criterion: item.criterion, weight, rating: null, state: "not_evidenced", explanation: "Not found in the pasted demo evidence.", evidence_quote: null, confidence: "low" };
    const rating = Math.min(5, Math.max(1, Math.round(5 * overlaps.length / Math.max(1, relevant.length))));
    assessedWeight += weight;
    weighted += weight * rating / 5;
    const line = text.split(/\r?\n|(?<=[.!?])\s+/).find((sentence: string) => overlaps.some((term: string) => sentence.toLowerCase().includes(term.toLowerCase())));
    return { criterion: item.criterion, weight, rating, state: overlaps.length >= Math.max(1, Math.ceil(relevant.length * 0.6)) ? "supported" : "partially_supported", explanation: "Illustrative browser-demo keyword evidence. Review the original profile.", evidence_quote: line?.slice(0, 500) || null, confidence: "low" };
  });
  return { match_score: assessedWeight ? Math.round(100 * weighted / assessedWeight) : null, evidence_coverage: totalWeight ? Math.round(100 * assessedWeight / totalWeight) : 0, confidence: "low", review_priority: "manual_review", criteria, notice: "Demo comparison only. Scores are advisory and require human review." };
}

export async function demoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const data = load();
  const method = (init.method || "GET").toUpperCase();
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const body = bodyValue(init);
  let result: any = {};
  let matched = false;
  const set = (value: any) => { result = value; matched = true; };

  if (pathname === "/me") set({ id: USER_ID, email: "demo@mosahay.com", workspaces: [{ org_id: ORG_ID, role: "owner", organizations: { id: ORG_ID, name: "MoSahay Demo Agency", created_at: daysAgo(90) } }] });
  else if (pathname === "/dashboard") set({ active_jobs: data.jobs.filter((row: AnyRow) => row.status === "open").length, total_jobs: data.jobs.length, candidate_count: data.candidates.length, needs_review: data.applications.filter((row: AnyRow) => row.stage === "Needs Review").length, stage_counts: pipelineReport(data).by_stage });
  else if (pathname === "/clients" && method === "GET") set(data.clients);
  else if (pathname === "/clients" && method === "POST") { const row = { ...body, id: id("client"), created_at: now() }; data.clients.unshift(row); save(data); set(row); }
  else if (pathname === "/jobs" && method === "GET") set(data.jobs);
  else if (pathname === "/jobs" && method === "POST") { const row = { ...body, id: id("job"), created_at: now(), requirements: [] }; data.jobs.unshift(row); save(data); set(row); }
  else if (pathname === "/candidates" && method === "GET") set(data.candidates);
  else if (pathname === "/activity") set(data.activity);
  else if (/^\/organizations\/[^/]+\/members$/.test(pathname) && method === "GET") set(data.members);
  else if (/^\/organizations\/[^/]+\/members\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.members.find((item: AnyRow) => item.user_id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (/^\/organizations\/[^/]+\/audit-logs$/.test(pathname)) set(data.audit_logs);
  else if (/^\/organizations\/[^/]+$/.test(pathname) && method === "GET") set({ id: ORG_ID, name: "MoSahay Demo Agency", privacy_notice_text: "Candidates share their information for recruitment review. Human reviewers make every hiring decision.", privacy_notice_version: "2026-01", retention_days: 365, ai_processing_enabled: false, ai_notice_acknowledged: false });
  else if (/^\/organizations\/[^/]+$/.test(pathname) && method === "PATCH") set({ ...body, id: ORG_ID, name: body.name || "MoSahay Demo Agency" });
  else if (pathname === "/privacy-requests" && method === "GET") set(data.privacy_requests);
  else if (pathname === "/privacy-requests" && method === "POST") { const row = { ...body, id: id("privacy"), status: "open", created_at: now() }; data.privacy_requests.unshift(row); save(data); set(row); }
  else if (/^\/privacy-requests\/[^/]+\/fulfill-deletion$/.test(pathname)) { const row = data.privacy_requests.find((item: AnyRow) => item.id === pathname.split("/")[2]); if (row) row.status = "fulfilled"; save(data); set({ status: "fulfilled" }); }
  else if (/^\/privacy-requests\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.privacy_requests.find((item: AnyRow) => item.id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (pathname === "/employer-leads" && method === "GET") set(data.leads);
  else if (/^\/employer-leads\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.leads.find((item: AnyRow) => item.id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (/^\/employer-leads\/[^/]+\/convert$/.test(pathname)) { const lead = data.leads.find((item: AnyRow) => item.id === pathname.split("/")[2]); if (lead) { lead.status = "converted"; data.clients.push({ id: id("client"), org_id: ORG_ID, name: lead.company_name, website: lead.website, created_at: now() }); save(data); } set({ status: "converted" }); }
  else if (pathname === "/tasks" && method === "GET") set(data.tasks);
  else if (pathname === "/tasks" && method === "POST") { const row = { ...body, id: id("task"), status: "open", created_at: now() }; data.tasks.unshift(row); save(data); set(row); }
  else if (/^\/tasks\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.tasks.find((item: AnyRow) => item.id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (pathname === "/interviews" && method === "GET") set(data.interviews);
  else if (/^\/interviews\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.interviews.find((item: AnyRow) => item.id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (pathname === "/placements" && method === "GET") set(data.placements);
  else if (pathname === "/placements" && method === "POST") { const row = { ...body, id: id("placement"), expected_fee: Number(body.fee_value || 0), invoice_status: "not_invoiced", payment_status: "unpaid", status: "active", created_at: now() }; data.placements.unshift(row); save(data); set(row); }
  else if (pathname === "/submissions" && method === "GET") set(data.submissions);
  else if (pathname === "/client-portal/submissions") set(data.submissions.map((row: AnyRow) => ({ ...row, applications: joinApplication(data, data.applications.find((app: AnyRow) => app.id === row.application_id) || {}) })));
  else if (pathname === "/analytics/pipeline") set(pipelineReport(data));
  else if (pathname.startsWith("/analytics/executive")) set(executiveReport(data));
  else if (pathname === "/analytics/export.csv") set("application_id,candidate_name,current_title,job_title,stage,created_at\r\n" + data.applications.map((row: AnyRow) => { const app = joinApplication(data, row); return `${app.id},${app.candidates?.full_name || ""},${app.candidates?.current_title || ""},${app.jobs?.title || ""},${app.stage},${app.created_at}`; }).join("\r\n"));
  else if (/^\/jobs\/[^/]+\/applications$/.test(pathname) && method === "GET") { const jobId = pathname.split("/")[2]; const stage = params.get("stage"); set(appRows(data, jobId).filter((row: AnyRow) => !stage || row.stage === stage)); }
  else if (/^\/jobs\/[^/]+\/requirements$/.test(pathname) && method === "GET") { const job = data.jobs.find((row: AnyRow) => row.id === pathname.split("/")[2]); set(job?.requirements || []); }
  else if (/^\/jobs\/[^/]+\/requirements$/.test(pathname) && method === "POST") { const job = data.jobs.find((row: AnyRow) => row.id === pathname.split("/")[2]); const row = { ...body, id: id("req"), active: true }; if (job) job.requirements.push(row); save(data); set(row); }
  else if (/^\/jobs\/[^/]+\/requirements\/[^/]+$/.test(pathname) && method === "PATCH") { const [, , jobId, , reqId] = pathname.split("/"); const job = data.jobs.find((row: AnyRow) => row.id === jobId); const row = job?.requirements.find((item: AnyRow) => item.id === reqId); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (/^\/jobs\/[^/]+\/requirements\/[^/]+$/.test(pathname) && method === "DELETE") { const [, , jobId, , reqId] = pathname.split("/"); const job = data.jobs.find((row: AnyRow) => row.id === jobId); if (job) job.requirements = job.requirements.filter((item: AnyRow) => item.id !== reqId); save(data); set(undefined); }
  else if (/^\/jobs\/[^/]+\/xray-search$/.test(pathname) && method === "GET") { const job = data.jobs.find((row: AnyRow) => row.id === pathname.split("/")[2]); set(job ? { job_id: job.id, job_title: job.title, queries: demoXrayQueries(job), generated_at: now() } : { queries: [] }); }
  else if (/^\/jobs\/[^/]+\/xray-profiles$/.test(pathname) && method === "GET") set(data.xray_profiles.filter((row: AnyRow) => row.job_id === pathname.split("/")[2]));
  else if (/^\/jobs\/[^/]+\/xray-profiles$/.test(pathname) && method === "POST") {
    const jobId = pathname.split("/")[2]; const invalid_urls: AnyRow[] = [];
    for (const raw of body.urls || []) {
      let url: URL;
      try { url = new URL(String(raw).includes("://") ? String(raw) : `https://${raw}`); } catch { invalid_urls.push({ url: String(raw), reason: "Paste a valid LinkedIn profile URL." }); continue; }
      if (!(url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) || !url.pathname.startsWith("/in/")) { invalid_urls.push({ url: String(raw), reason: "Use an individual linkedin.com/in/ profile URL." }); continue; }
      const canonical = `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}/`;
      if (!data.xray_profiles.some((item: AnyRow) => item.job_id === jobId && item.linkedin_url === canonical)) data.xray_profiles.unshift({ id: id("xray"), job_id: jobId, linkedin_url: canonical, name: "", headline: "", profile_text: "", score_result: null, created_at: now() });
    }
    save(data); set({ profiles: data.xray_profiles.filter((item: AnyRow) => item.job_id === jobId), imported: (body.urls || []).length - invalid_urls.length, invalid_urls });
  }
  else if (/^\/jobs\/[^/]+\/xray-profiles\/[^/]+\/compare$/.test(pathname) && method === "POST") {
    const [, , jobId, , profileId] = pathname.split("/"); const profile = data.xray_profiles.find((item: AnyRow) => item.id === profileId && item.job_id === jobId); const job = data.jobs.find((item: AnyRow) => item.id === jobId);
    if (profile && job) { Object.assign(profile, body, { score_result: scoreDemoXrayProfile(job, body.profile_text || ""), scored_at: now(), updated_at: now() }); save(data); }
    set(profile || {});
  }
  else if (/^\/jobs\/[^/]+\/xray-profiles\/[^/]+$/.test(pathname) && method === "DELETE") { const [, , jobId, , profileId] = pathname.split("/"); data.xray_profiles = data.xray_profiles.filter((item: AnyRow) => item.id !== profileId || item.job_id !== jobId); save(data); set(undefined); }
  else if (/^\/jobs\/[^/]+\/reviewers$/.test(pathname) && method === "GET") set(data.reviewers[pathname.split("/")[2]] || []);
  else if (/^\/jobs\/[^/]+\/reviewers$/.test(pathname) && method === "POST") { const jobId = pathname.split("/")[2]; const row = { id: id("reviewer"), user_id: body.user_id, job_id: jobId, assigned_by: USER_ID, created_at: now() }; data.reviewers[jobId] ||= []; data.reviewers[jobId].push(row); save(data); set(row); }
  else if (/^\/jobs\/[^/]+\/reviewers\/[^/]+$/.test(pathname) && method === "DELETE") { const [, , jobId, , userId] = pathname.split("/"); data.reviewers[jobId] = (data.reviewers[jobId] || []).filter((row: AnyRow) => row.user_id !== userId); save(data); set(undefined); }
  else if (/^\/jobs\/[^/]+\/reviewers\/invite$/.test(pathname)) set({ email: body.email, invite_sent: false, demo: true });
  else if (/^\/jobs\/[^/]+\/interview-questions$/.test(pathname) && method === "GET") set({ questions: data.interview_questions[pathname.split("/")[2]] || ["Describe a role-related project you owned.", "How do you approach a difficult stakeholder decision?", "What evidence would you use to measure success in this role?"] });
  else if (/^\/jobs\/[^/]+\/interview-questions$/.test(pathname) && method === "PUT") { data.interview_questions[pathname.split("/")[2]] = body.questions || []; save(data); set({ questions: body.questions || [] }); }
  else if (/^\/jobs\/[^/]+\/parse-jd$/.test(pathname)) set({ proposals: [{ criterion: "Relevant role experience", description: "Confirm this requirement with the hiring manager.", weight: 35 }, { criterion: "Core skills", description: "Edit the skill criteria to match the supplied job description.", weight: 30 }], notice: "Demo mode: illustrative extraction only." });
  else if (/^\/jobs\/[^/]+\/public-listing$/.test(pathname) && method === "PATCH") { const job = data.jobs.find((row: AnyRow) => row.id === pathname.split("/")[2]); if (job) { job.public_listing_enabled = body.enabled; job.public_slug ||= job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-demo"; } save(data); set(job || {}); }
  else if (/^\/jobs\/[^/]+$/.test(pathname) && method === "GET") { const job = data.jobs.find((row: AnyRow) => row.id === pathname.split("/").at(-1)); set(job ? { ...job, clients: data.clients.find((client: AnyRow) => client.id === job.client_id), applications: appRows(data, job.id) } : {}); }
  else if (/^\/jobs\/[^/]+$/.test(pathname) && method === "PATCH") { const job = data.jobs.find((row: AnyRow) => row.id === pathname.split("/").at(-1)); if (job) Object.assign(job, body); save(data); set(job || {}); }
  else if (/^\/jobs\/[^/]+\/record-current-privacy-notice$/.test(pathname)) set({ ok: true });
  else if (/^\/jobs\/[^/]+\/applications$/.test(pathname) && method === "POST") set({});
  else if (/^\/jobs\/[^/]+\/resumes$/.test(pathname) && method === "POST") {
    const form = init.body instanceof FormData ? init.body : null;
    const files = form ? form.getAll("files").filter((value): value is File => value instanceof File) : [];
    const jobId = pathname.split("/")[2];
    const results = files.map(file => {
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Demo Candidate";
      const candidate = { id: id("candidate"), org_id: ORG_ID, full_name: name, current_title: "Resume upload · demo only", current_employer: null, email: "", phone: "", skills: [], source: "recruiter_upload", parse_status: "needs_manual_review", consent_status: form?.get("consent_status") || "not_recorded", created_at: now(), parsed_profile: { experiences: [], educations: [] } };
      data.candidates.unshift(candidate);
      const app = { id: id("application"), org_id: ORG_ID, candidate_id: candidate.id, job_id: jobId, owner_id: USER_ID, stage: "Needs Review", status: "active", created_at: now(), latest_score: null };
      data.applications.unshift(app);
      return { filename: file.name, status: "needs_manual_review", candidate_id: candidate.id, application_id: app.id, duplicate_warning: false, duplicate_signals: [], warnings: ["Demo mode: this file was not uploaded or parsed."] };
    });
    save(data); set({ total: results.length, created: results.length, reused: 0, failed: 0, results });
  }
  else if (pathname === "/candidates/import.csv" && method === "POST") {
    const form = init.body instanceof FormData ? init.body : null; const file = form?.get("file");
    const text = file instanceof File ? await file.text() : ""; const lines = text.split(/\r?\n/).filter(Boolean); const headers = (lines.shift() || "").split(",").map((item: string) => item.trim());
    const results = lines.map((line: string, index: number) => { const cells = line.split(","); const row = Object.fromEntries(headers.map((key: string, i: number) => [key, cells[i] || ""])); const candidate = { id: id("candidate"), org_id: ORG_ID, full_name: row.full_name || "Demo Candidate", email: row.email || null, phone: row.phone || null, current_title: row.current_title || null, current_employer: row.current_employer || null, skills: String(row.skills || "").split(/[;,|]/).map((item: string) => item.trim()).filter(Boolean), source: row.source || "csv_import", parse_status: "not_uploaded", consent_status: "not_recorded", created_at: now(), parsed_profile: {} }; data.candidates.unshift(candidate); return { row: index + 2, status: "imported", candidate_id: candidate.id }; });
    save(data); set({ total: results.length, imported: results.length, duplicate_review: 0, failed: 0, results });
  }
  else if (/^\/candidates\/[^/]+\/resume-url$/.test(pathname)) { const candidate = data.candidates.find((row: AnyRow) => row.id === pathname.split("/")[2]); set({ url: `data:text/plain;charset=utf-8,${encodeURIComponent(`Demo resume preview\n${candidate?.full_name || "Candidate"}\n${candidate?.current_title || ""}\n\nDemo mode does not store uploaded resume files.`)}` }); }
  else if (/^\/candidates\/[^/]+\/resumes$/.test(pathname) && method === "POST") { const candidate = data.candidates.find((row: AnyRow) => row.id === pathname.split("/")[2]); set({ status: "needs_manual_review", warnings: ["Demo mode: the resume file was not uploaded or parsed."], asset: { id: id("resume"), original_filename: "demo-resume", parse_status: "needs_manual_review", created_at: now() } }); if (candidate) candidate.parse_status = "needs_manual_review"; save(data); }
  else if (/^\/candidates\/[^/]+$/.test(pathname) && method === "GET") { const candidate = data.candidates.find((row: AnyRow) => row.id === pathname.split("/").at(-1)); set(candidate ? { ...candidate, resume_assets: [], applications: appRows(data).filter((row: AnyRow) => row.candidate_id === candidate.id), parsed_profile: candidate.parsed_profile || {} } : {}); }
  else if (/^\/candidates\/[^/]+$/.test(pathname) && method === "PATCH") { const candidate = data.candidates.find((row: AnyRow) => row.id === pathname.split("/").at(-1)); if (candidate) Object.assign(candidate, body); save(data); set(candidate || {}); }
  else if (/^\/applications\/[^/]+\/score$/.test(pathname) && method === "POST") { const scoreRun = scoreDemoApplication(data, pathname.split("/")[2]); save(data); set(scoreRun || {}); }
  else if (/^\/jobs\/[^/]+\/bulk-score$/.test(pathname) && method === "POST") { const results = (body.application_ids || []).map((application_id: string) => { const scoreRun = scoreDemoApplication(data, application_id); return scoreRun ? { application_id, status: "scored", total_score: scoreRun.total_score } : { application_id, status: "failed", error: "Sample application was not found." }; }); const succeeded = results.filter((row: AnyRow) => row.status === "scored").length; save(data); set({ total: results.length, succeeded, failed: results.length - succeeded, results }); }
  else if (/^\/applications\/[^/]+\/score-runs$/.test(pathname)) set(data.score_runs[pathname.split("/")[2]] || []);
  else if (/^\/applications\/[^/]+\/notes$/.test(pathname) && method === "GET") set(data.notes[pathname.split("/")[2]] || []);
  else if (/^\/applications\/[^/]+\/notes$/.test(pathname) && method === "POST") { const key = pathname.split("/")[2]; const row = { id: id("note"), body: body.body, author_id: USER_ID, created_at: now() }; data.notes[key] ||= []; data.notes[key].unshift(row); save(data); set(row); }
  else if (/^\/applications\/[^/]+\/scorecards$/.test(pathname) && method === "GET") set(data.scorecards.filter((row: AnyRow) => row.application_id === pathname.split("/")[2]));
  else if (/^\/applications\/[^/]+\/scorecards$/.test(pathname) && method === "POST") { const row = { ...body, id: id("scorecard"), application_id: pathname.split("/")[2], reviewer_id: USER_ID, created_at: now() }; data.scorecards.unshift(row); save(data); set(row); }
  else if (/^\/applications\/[^/]+\/stage$/.test(pathname) && method === "PATCH") { const app = data.applications.find((row: AnyRow) => row.id === pathname.split("/")[2]); if (app) { app.stage = body.stage; app.decision_reason = body.decision_reason; } save(data); set(app || {}); }
  else if (/^\/applications\/[^/]+\/assign$/.test(pathname) && method === "PATCH") { const app = data.applications.find((row: AnyRow) => row.id === pathname.split("/")[2]); if (app) app.owner_id = body.assigned_to; save(data); set(app || {}); }
  else if (/^\/applications\/[^/]+\/submit-to-client$/.test(pathname) && method === "POST") { const app = data.applications.find((row: AnyRow) => row.id === pathname.split("/")[2]); if (app && !data.submissions.some((row: AnyRow) => row.application_id === app.id)) data.submissions.push({ id: id("submission"), application_id: app.id, org_id: ORG_ID, status: "pending", created_at: now(), clients: data.clients.find((client: AnyRow) => client.id === data.jobs.find((job: AnyRow) => job.id === app.job_id)?.client_id), shared_profile: { candidate_name: data.candidates.find((candidate: AnyRow) => candidate.id === app.candidate_id)?.full_name, job_title: data.jobs.find((job: AnyRow) => job.id === app.job_id)?.title, skills: data.candidates.find((candidate: AnyRow) => candidate.id === app.candidate_id)?.skills || [], candidate_reference: app.id.slice(-8) } }); save(data); set({ id: data.submissions.at(-1)?.id }); }
  else if (/^\/client-portal\/submissions\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.submissions.find((item: AnyRow) => item.id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (/^\/applications\/[^/]+\/interviews$/.test(pathname) && method === "POST") { const appId = pathname.split("/")[2]; const app = data.applications.find((row: AnyRow) => row.id === appId); const row = { ...body, id: id("interview"), org_id: ORG_ID, application_id: appId, candidate_id: app?.candidate_id, job_id: app?.job_id, status: "scheduled", created_at: now() }; data.interviews.unshift({ ...row, candidates: data.candidates.find((item: AnyRow) => item.id === row.candidate_id), jobs: data.jobs.find((item: AnyRow) => item.id === row.job_id) }); save(data); set(row); }
  else if (/^\/placements\/[^/]+\/replacements$/.test(pathname) && method === "POST") { const placement = data.placements.find((row: AnyRow) => row.id === pathname.split("/")[2]); const row = { id: id("replacement"), reason: body.reason, status: "open", created_at: now() }; if (placement) { placement.replacement_records ||= []; placement.replacement_records.push(row); } save(data); set(row); }
  else if (/^\/placements\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.placements.find((item: AnyRow) => item.id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (/^\/jobs\/[^/]+\/posters$/.test(pathname) && method === "GET") set(data.posters.filter((row: AnyRow) => row.job_id === pathname.split("/")[2]));
  else if (/^\/jobs\/[^/]+\/posters$/.test(pathname) && method === "POST") { const row = { ...body, id: id("poster"), job_id: pathname.split("/")[2], org_id: ORG_ID, status: "draft", created_at: now() }; data.posters.unshift(row); save(data); set(row); }
  else if (/^\/posters\/[^/]+$/.test(pathname) && method === "PATCH") { const row = data.posters.find((item: AnyRow) => item.id === pathname.split("/").at(-1)); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (/^\/clients\/[^/]+\/crm$/.test(pathname)) { const clientId = pathname.split("/")[2]; set(data.crm[clientId] || { contacts: [], offices: [], contracts: [], contracts_visible: true, activities: [] }); }
  else if (/^\/clients\/[^/]+\/(contacts|offices|contracts)$/.test(pathname) && method === "POST") { const [, , clientId, kind] = pathname.split("/"); const crm = data.crm[clientId] ||= { contacts: [], offices: [], contracts: [], contracts_visible: true, activities: [] }; const row = { ...body, id: id(kind.slice(0, -1)), created_at: now() }; crm[kind].unshift(row); save(data); set(row); }
  else if (/^\/clients\/[^/]+\/(contacts|offices|contracts)\/[^/]+$/.test(pathname) && method === "PATCH") { const [, , clientId, kind, recordId] = pathname.split("/"); const row = data.crm[clientId]?.[kind]?.find((item: AnyRow) => item.id === recordId); if (row) Object.assign(row, body); save(data); set(row || {}); }
  else if (/^\/clients\/[^/]+\/activities$/.test(pathname) && method === "POST") { const clientId = pathname.split("/")[2]; const crm = data.crm[clientId] ||= { contacts: [], offices: [], contracts: [], contracts_visible: true, activities: [] }; const row = { ...body, id: id("activity"), happened_at: now() }; crm.activities.unshift(row); save(data); set(row); }
  else if (!matched && method === "GET") set([]);
  else if (!matched && method === "POST") set({ ...body, id: id("demo"), created_at: now() });
  else if (!matched && method === "PATCH") set({ ...body, id: pathname.split("/").at(-1) });
  else if (!matched && method === "DELETE") set(undefined);
  if (!matched) set({ ok: true, demo: true });
  return result as T;
}

export function resetDemoData() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORE_KEY);
}
