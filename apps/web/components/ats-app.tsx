"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowRight, BriefcaseBusiness, Building2,
  Check, ChevronDown, CircleHelp, Download, FileText, Filter, Image as ImageIcon, LayoutDashboard, LoaderCircle, LogOut,
  CalendarDays, ClipboardList, Palette, Plus, Printer, Save, Search, Send, Settings2, ShieldCheck, Sparkles, Users, WalletCards, X,
} from "lucide-react";
import { api, apiBase, json } from "@/lib/api";
import { resetDemoData } from "@/lib/demo-api";
import { clientSchema, jobSchema, workspaceSchema } from "@/lib/validators";
import { ClientPortalPage, InterviewPage, PlacementsPage, SubmissionPage, TaskPage } from "./operations";
import { ClientCrmModal } from "./client-crm";
import { ExecutiveReport } from "./executive-report";
import { XRaySourcingPage } from "./xray-sourcing";

type Workspace = { id: string; name: string; role: string };
type Client = { id: string; name: string; website?: string };
type EmployerLead = { id: string; company_name: string; website?: string | null; contact_name: string; email: string; phone: string; job_title: string; vacancies: number; required_skills: string[]; location: string; experience?: string | null; salary_min?: number | null; salary_max?: number | null; hiring_timeline: string; status: string; converted_client_id?: string | null; created_at: string };
type Job = { id: string; title: string; status: string; client_id?: string; description: string; location?: string; work_arrangement?: string; employment_type?: string; salary_min?: number; salary_max?: number; salary_currency?: string; vacancies?: number; experience_min?: number; experience_max?: number; application_deadline?: string; department?: string; industry?: string; public_slug?: string; public_listing_enabled?: boolean; privacy_notice_version?: string; scoring_version?: number; created_at: string; requirements?: Requirement[] };
type Requirement = { id: string; criterion: string; description: string; weight: number; required: boolean; aliases?: string[]; active?: boolean };
type Candidate = { id: string; full_name?: string; current_title?: string; current_employer?: string; skills?: string[]; parse_status: string; source?: string; created_at: string };
type Application = { id: string; job_id?: string; owner_id?: string | null; stage: string; created_at: string; candidates?: Candidate; jobs?: { title: string }; latest_score?: any; score?: number };
type ActivityItem = { id: string; action: string; created_at: string; entity_type: string };
type Screen = "dashboard" | "jobs" | "clients" | "candidates" | "pipeline" | "xray-sourcing" | "poster-studio" | "submissions" | "interviews" | "tasks" | "placements" | "reports" | "settings" | "client-portal";

type PosterRecord = { id: string; title: string; template_id: string; format: string; language: string; status: string; poster_copy: Record<string, string>; style: Record<string, string | number>; created_at: string };

const stages = ["New", "Parsing", "Needs Review", "Shortlisted", "Recruiter Screen", "Submitted to Client", "Interview", "Offer", "Hired", "Rejected", "Withdrawn", "Talent Pool"];
const MANAGER_ROLES_UI = ["owner", "admin", "recruitment_manager"];
function initials(name?: string) { return (name || "?").split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join(""); }
function dateLabel(value?: string) { return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"; }
function noticeMessage(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please retry."; }

export function AtsApp({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const token = session.access_token;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [org, setOrg] = useState<Workspace | null>(null);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [privacyRequests, setPrivacyRequests] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [showClientForm, setShowClientForm] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [scoreDetail, setScoreDetail] = useState<any>(null);
  const [showScorecard, setShowScorecard] = useState<Application | null>(null);

  const refreshMe = useCallback(async () => {
    const result = await api<any>("/me", token);
    const mapped = (result.workspaces || []).map((entry: any) => ({ id: entry.org_id, name: entry.organizations?.name || "Workspace", role: entry.role }));
    setWorkspaces(mapped);
    setOrg(current => mapped.find((item: Workspace) => item.id === current?.id) || mapped[0] || null);
    setBusy(false);
  }, [token]);

  const refreshWorkspaceData = useCallback(async (selected: Workspace) => {
    setBusy(true); setError("");
    try {
      const [dashboardData, jobData, clientData, candidateData, activityData, settingsData, memberData, privacyData, auditData] = await Promise.all([
        api<any>(`/dashboard?org_id=${selected.id}`, token),
        api<Job[]>(`/jobs?org_id=${selected.id}`, token),
        api<Client[]>(`/clients?org_id=${selected.id}`, token),
        api<Candidate[]>(`/candidates?org_id=${selected.id}&limit=100`, token),
        api<ActivityItem[]>(`/activity?org_id=${selected.id}&limit=12`, token),
        api<any>(`/organizations/${selected.id}`, token),
        api<any[]>(`/organizations/${selected.id}/members`, token),
        api<any[]>(`/privacy-requests?org_id=${selected.id}`, token).catch(() => []),
        api<any[]>(`/organizations/${selected.id}/audit-logs?limit=100`, token).catch(() => []),
      ]);
      setMetrics(dashboardData); setJobs(jobData); setClients(clientData); setCandidates(candidateData); setActivity(activityData); setSettings(settingsData); setMembers(memberData); setPrivacyRequests(privacyData); setAuditLogs(auditData);
    } catch (e) { setError(noticeMessage(e)); }
    finally { setBusy(false); }
  }, [token]);

  useEffect(() => { refreshMe().catch(e => { setError(noticeMessage(e)); setBusy(false); }); }, [refreshMe]);
  useEffect(() => { if (org) refreshWorkspaceData(org); }, [org, refreshWorkspaceData]);
  useEffect(() => { if (org?.role === "reviewer") setScreen("client-portal"); else if (screen === "client-portal") setScreen("dashboard"); }, [org?.role, screen]);
  useEffect(() => {
    if (!org || !job) { setApplications([]); return; }
    api<Application[]>(`/jobs/${job.id}/applications?sort=created_at&limit=100`, token).then(setApplications).catch(e => setError(noticeMessage(e)));
  }, [job, org, token]);
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(""), 3800); return () => window.clearTimeout(timer); } }, [toast]);

  const filteredJobs = useMemo(() => jobs.filter(item => `${item.title} ${item.status}`.toLowerCase().includes(search.toLowerCase())), [jobs, search]);
  const filteredCandidates = useMemo(() => candidates.filter(item => `${item.full_name || ""} ${item.current_title || ""} ${item.current_employer || ""} ${(item.skills || []).join(" ")}`.toLowerCase().includes(candidateQuery.toLowerCase())), [candidates, candidateQuery]);

  async function chooseWorkspace(id: string) { const selected = workspaces.find(item => item.id === id); if (selected) { setOrg(selected); setJob(null); } }
  async function doRefresh() { if (org) await refreshWorkspaceData(org); }
  async function runScore(application: Application) {
    try { const result = await api<any>(`/applications/${application.id}/score`, token, { method: "POST" }); setScoreDetail({ application, result, history: { ...result, created_at: new Date().toISOString() } }); if (job) setApplications(await api<Application[]>(`/jobs/${job.id}/applications?sort=created_at&limit=100`, token)); await doRefresh(); }
    catch (e) { setError(noticeMessage(e)); }
  }
  async function moveStage(application: Application, stage: string) {
    const decision_reason = ["Hired", "Rejected", "Withdrawn"].includes(stage) ? window.prompt(`Record the human decision reason for ${stage.toLowerCase()}:`) : undefined;
    if (["Hired", "Rejected", "Withdrawn"].includes(stage) && !decision_reason?.trim()) return;
    try { await api(`/applications/${application.id}/stage`, token, { method: "PATCH", body: json({ stage, decision_reason }) }); setToast(`Moved to ${stage}`); if (job) setApplications(await api<Application[]>(`/jobs/${job.id}/applications?limit=100`, token)); await doRefresh(); }
    catch (e) { setError(noticeMessage(e)); }
  }

  if (busy && !metrics && !workspaces.length) return <div className="loading-screen"><LoaderCircle className="spin" size={24} /><span>Loading workspace data…</span></div>;
  if (!workspaces.length && !busy) return <WorkspaceSetup token={token} onCreated={async () => { await refreshMe(); }} error={error} onSignOut={onSignOut} />;
  if (!org) return <div className="loading-screen"><LoaderCircle className="spin" size={24} /><span>Loading your workspace…</span></div>;

  const internalNav: { id: Screen; label: string; icon: any }[] = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "jobs", label: "Jobs", icon: BriefcaseBusiness },
    { id: "clients", label: "Clients & leads", icon: Building2 },
    { id: "candidates", label: "Candidates", icon: Users },
    { id: "pipeline", label: "Pipeline", icon: Activity },
    { id: "xray-sourcing", label: "X-Ray sourcing", icon: Search },
    { id: "poster-studio", label: "Poster Studio", icon: Palette },
    { id: "submissions", label: "Client submissions", icon: Send },
    { id: "interviews", label: "Interviews", icon: CalendarDays },
    { id: "tasks", label: "Tasks", icon: ClipboardList },
    { id: "placements", label: "Placements", icon: WalletCards },
    { id: "reports", label: "Reports", icon: FileText },
    { id: "settings", label: "Workspace settings", icon: Settings2 },
  ];
  const nav: { id: Screen; label: string; icon: any }[] = org.role === "reviewer"
    ? [{ id: "client-portal", label: "Client portal", icon: ShieldCheck }]
    : org.role === "sourcer"
      ? internalNav.filter(item => ["dashboard", "jobs", "candidates", "xray-sourcing", "tasks"].includes(item.id))
      : org.role === "finance"
        ? internalNav.filter(item => ["dashboard", "placements", "reports"].includes(item.id))
        : internalNav;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand sidebar-brand"><span className="brand-mark"><BriefcaseBusiness size={18} /></span><span>MoSahay <b>RecruitOS</b></span></div>
      <div className="workspace-picker"><div className="workspace-icon"><Building2 size={17} /></div><div className="workspace-meta"><small>WORKSPACE</small><strong>{org.name}</strong></div>{workspaces.length > 1 && <select aria-label="Switch workspace" value={org.id} onChange={e => chooseWorkspace(e.target.value)}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>
      <div className="nav-label">RECRUIT</div>
      <nav className="side-nav" aria-label="Main navigation">{nav.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${screen === item.id ? "active" : ""}`} onClick={() => { setScreen(item.id); setJob(null); setSearch(""); }}><Icon size={17} /><span>{item.label}</span>{item.id === "jobs" && <span className="nav-count">{jobs.length}</span>}</button>; })}</nav>
      <div className="sidebar-spacer" />
      <div className="privacy-mini"><div className="privacy-mini-icon"><ShieldCheck size={17} /></div><div><strong>Human-led decisions</strong><span>Scores support review. People make every hiring decision.</span></div></div>
      <div className="user-card"><div className="avatar avatar-slate">{initials(session.user.email)}</div><div className="user-meta"><strong>{session.user.email?.split("@")[0]}</strong><span>{org.role}</span></div><button className="icon-button" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{job ? job.title : nav.find(item => item.id === screen)?.label}</strong></div><div className="topbar-actions"><div className="topbar-date">{new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div><div className="avatar avatar-top">{initials(session.user.email)}</div></div></header>
      <div className="content-wrap">
        {token.startsWith("demo:") && <div className="notice notice-warning demo-mode-banner"><ShieldCheck size={16} /><span><b>Demo mode.</b> Changes are local to this browser; uploads, email, invitations, and AI are simulated. Login: <code>demo@mosahay.com</code> / <code>RecruitOSDemo2026!</code></span><button className="text-button" onClick={() => { resetDemoData(); window.location.reload(); }}>Reset sample data</button></div>}
        {error && <div className="notice notice-error" role="alert"><AlertTriangle size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
        {busy && metrics && <div className="sync-line"><LoaderCircle size={14} className="spin" /> Refreshing workspace…</div>}
        {screen === "dashboard" && !job && <Dashboard org={org} metrics={metrics} jobs={jobs} activity={activity} onOpenJobs={() => setScreen("jobs")} onOpenJob={setJob} />}
        {screen === "jobs" && (job ? <JobDetail job={job} clients={clients} applications={applications} members={members} token={token} org={org} privacyNoticeText={settings?.privacy_notice_text || ""} onBack={() => setJob(null)} onUpdate={async () => { await doRefresh(); setJob(await api<Job>(`/jobs/${job.id}`, token)); }} onScore={runScore} onStage={moveStage} onScorecard={setShowScorecard} onToast={setToast} onError={setError} /> : <JobsPage jobs={filteredJobs} allCount={jobs.length} clients={clients} search={search} setSearch={setSearch} onOpenJob={setJob} onCreateJob={() => setShowJobForm(true)} onCreateClient={() => setShowClientForm(true)} canCreate={org.role !== "sourcer"} />)}
        {screen === "clients" && <ClientsPage org={org} clients={clients} jobs={jobs} token={token} canManageLeads={MANAGER_ROLES_UI.includes(org.role)} onCreateClient={() => setShowClientForm(true)} onRefresh={doRefresh} onToast={setToast} onError={setError} />}
        {screen === "candidates" && <CandidatesPage candidates={filteredCandidates} total={candidates.length} search={candidateQuery} setSearch={setCandidateQuery} token={token} orgId={org.id} onRefresh={doRefresh} allowPrivacyRequest={org.role !== "sourcer"} />}
        {screen === "pipeline" && <PipelinePage jobs={jobs} token={token} onOpenJob={selected => { setJob(selected); setScreen("jobs"); }} />}
        {screen === "xray-sourcing" && <XRaySourcingPage jobs={jobs} token={token} />}
        {screen === "poster-studio" && <PosterStudio org={org} jobs={jobs} clients={clients} token={token} onToast={setToast} onError={setError} />}
        {screen === "submissions" && <SubmissionPage org={org} token={token} jobs={jobs} />}
        {screen === "interviews" && <InterviewPage org={org} token={token} jobs={jobs} />}
        {screen === "tasks" && <TaskPage org={org} token={token} jobs={jobs} members={members} />}
        {screen === "placements" && <PlacementsPage org={org} token={token} jobs={jobs} role={org.role} />}
        {screen === "client-portal" && org.role === "reviewer" && <ClientPortalPage org={org} token={token} />}
        {screen === "reports" && <ReportsPage org={org} metrics={metrics} token={token} />}
        {screen === "reports" && MANAGER_ROLES_UI.includes(org.role) && <ExecutiveReport orgId={org.id} token={token} jobs={jobs} clients={clients} members={members} />}
        {screen === "settings" && <SettingsPage org={org} token={token} settings={settings} members={members} requests={privacyRequests} auditLogs={auditLogs} currentUserId={session.user.id} googleLinked={Boolean(session.user.app_metadata?.providers?.includes("google"))} onRefresh={doRefresh} onToast={setToast} />}
      </div>
    </main>
    {showClientForm && <ClientModal org={org} token={token} onClose={() => setShowClientForm(false)} onSaved={async () => { setShowClientForm(false); await doRefresh(); setToast("Client added"); }} onError={setError} />}
    {showJobForm && <JobModal org={org} clients={clients} token={token} onClose={() => setShowJobForm(false)} onSaved={async id => { setShowJobForm(false); await doRefresh(); const selected = await api<Job>(`/jobs/${id}`, token); setJob(selected); setToast("Job created. Review its description and requirements before scoring."); }} onError={setError} />}
    {scoreDetail && <EvidenceDrawer detail={scoreDetail} onClose={() => setScoreDetail(null)} />}
    {showScorecard && <ScorecardModal app={showScorecard} token={token} onClose={() => setShowScorecard(null)} onSaved={() => { setShowScorecard(null); setToast("Interview scorecard submitted"); }} onError={setError} />}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>;
}

function WorkspaceSetup({ token, onCreated, error, onSignOut }: { token: string; onCreated: () => Promise<void>; error: string; onSignOut: () => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof workspaceSchema>>({ resolver: zodResolver(workspaceSchema) });
  const [localError, setLocalError] = useState("");
  const submit = async (values: z.infer<typeof workspaceSchema>) => { setLocalError(""); try { await api("/organizations", token, { method: "POST", body: json(values) }); await onCreated(); } catch (e) { setLocalError(noticeMessage(e)); } };
  return <main className="setup-layout"><div className="setup-card"><div className="brand"><span className="brand-mark"><BriefcaseBusiness size={18} /></span><span>MoSahay <b>RecruitOS</b></span></div><div className="eyebrow">FIRST-RUN SETUP</div><h1>Create your agency workspace</h1><p>Putting people to productive work. Keep client requirements, candidates, and recruitment operations in one workspace.</p><form onSubmit={handleSubmit(submit)} className="stack-form"><label className="field-label">Agency or workspace name</label><input className="input" placeholder="MoSahay Recruitment" {...register("name")} />{errors.name && <span className="field-error">{errors.name.message}</span>}<button className="button button-primary" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create workspace"}<ArrowRight size={16} /></button></form>{(localError || error) && <div className="notice notice-error">{localError || error}</div>}<p className="setup-note">You’ll become the workspace owner. Member invitations are managed by an admin.</p><button className="text-button" onClick={onSignOut}>Sign out</button></div></main>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-header-actions">{actions}</div>}</div>;
}

function Dashboard({ org, metrics, jobs, activity, onOpenJobs, onOpenJob }: { org: Workspace; metrics: any; jobs: Job[]; activity: ActivityItem[]; onOpenJobs: () => void; onOpenJob: (job: Job) => void }) {
  const recentJobs = jobs.filter(job => job.status === "open").slice(0, 4);
  const stats = [
    { label: "Active jobs", value: metrics?.active_jobs ?? "—", note: `${metrics?.total_jobs ?? 0} total roles`, icon: BriefcaseBusiness, tint: "blue" },
    { label: "Candidates", value: metrics?.candidate_count ?? "—", note: "In this workspace", icon: Users, tint: "violet" },
    { label: "Needs review", value: metrics?.needs_review ?? "—", note: "Manual review queue", icon: CircleHelp, tint: "amber" },
    { label: "Pipeline stages", value: Object.values(metrics?.stage_counts || {}).reduce((a: number, b: any) => a + Number(b), 0), note: "Active applications", icon: Activity, tint: "green" },
  ];
  return <>
    <div className="welcome-row"><div><div className="eyebrow">YOUR RECRUITING DESK</div><h1>Good work starts with a clear view.</h1><p>Here’s what needs your attention in <b>{org.name}</b>.</p></div><div className="date-pill">{new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div></div>
    <div className="stat-grid">{stats.map(item => { const Icon = item.icon; return <article className="stat-card" key={item.label}><div className={`stat-icon ${item.tint}`}><Icon size={18} /></div><div className="stat-value">{item.value}</div><div className="stat-label">{item.label}</div><div className="stat-note">{item.note}</div></article>; })}</div>
    <div className="dashboard-grid">
      <section className="panel jobs-panel"><div className="panel-header"><div><div className="eyebrow">HIRING ACTIVITY</div><h2>Open roles</h2></div><button className="button button-ghost button-small" onClick={onOpenJobs}>All jobs <ArrowRight size={15} /></button></div>
        {recentJobs.length ? <div className="compact-job-list">{recentJobs.map((item, index) => <button className="compact-job" key={item.id} onClick={() => onOpenJob(item)}><div className={`job-index index-${index % 4}`}><BriefcaseBusiness size={17} /></div><div className="compact-job-main"><strong>{item.title}</strong><span>{item.location || "Location not set"} · Added {dateLabel(item.created_at)}</span></div><div className="job-status status-open">Open</div><ArrowRight className="row-arrow" size={15} /></button>)}</div> : <EmptyState icon={<BriefcaseBusiness size={20} />} title="No open roles yet" body="Create a client job to begin building your shortlist." />}
      </section>
      <section className="panel activity-panel"><div className="panel-header"><div><div className="eyebrow">LATEST UPDATES</div><h2>Recent activity</h2></div><Activity size={18} className="subtle-icon" /></div>
        {activity.length ? <div className="timeline">{activity.slice(0, 6).map((item, idx) => <div className="timeline-row" key={item.id}><span className={`timeline-dot dot-${idx % 4}`} /><div><strong>{item.action.replaceAll("_", " ")}</strong><span>{item.entity_type} · {dateLabel(item.created_at)}</span></div></div>)}</div> : <EmptyState icon={<Activity size={20} />} title="Your activity will show here" body="Changes to jobs and candidate workflows appear in this timeline." />}
      </section>
    </div>
    <div className="responsible-banner"><div className="banner-symbol"><ShieldCheck size={20} /></div><div><strong>A thoughtful process, by design.</strong><span>Candidate scores summarize cited resume evidence. Missing information stays unknown, and every final decision belongs to your team.</span></div><span className="advisory-pill">ADVISORY SCORING</span></div>
  </>;
}

function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{body}</p>{action}</div>; }

function ClientsPage({ org, clients, jobs, token, canManageLeads, onCreateClient, onRefresh, onToast, onError }: { org: Workspace; clients: Client[]; jobs: Job[]; token: string; canManageLeads: boolean; onCreateClient: () => void; onRefresh: () => Promise<void>; onToast: (s: string) => void; onError: (s: string) => void }) {
  const [leads, setLeads] = useState<EmployerLead[]>([]);
  const [loading, setLoading] = useState(canManageLeads);
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const clientJobs = new Map(clients.map(client => [client.id, jobs.filter(job => job.client_id === client.id)]));
  useEffect(() => {
    if (!canManageLeads) { setLoading(false); return; }
    let live = true; setLoading(true);
    api<EmployerLead[]>(`/employer-leads?org_id=${org.id}`, token).then(data => { if (live) setLeads(data); }).catch(error => { if (live) onError(noticeMessage(error)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [canManageLeads, org.id, token, onError]);
  async function updateLead(lead: EmployerLead, status: string) {
    try { const updated = await api<EmployerLead>(`/employer-leads/${lead.id}`, token, { method: "PATCH", body: json({ status }) }); setLeads(old => old.map(row => row.id === lead.id ? updated : row)); onToast("Lead status updated"); }
    catch (error) { onError(noticeMessage(error)); }
  }
  async function convertLead(lead: EmployerLead) {
    try { await api(`/employer-leads/${lead.id}/convert`, token, { method: "POST" }); await onRefresh(); setLeads(old => old.map(row => row.id === lead.id ? { ...row, status: "converted" } : row)); onToast(`${lead.company_name} converted to a client`); }
    catch (error) { onError(noticeMessage(error)); }
  }
  const visibleLeads = leads.filter(lead => `${lead.company_name} ${lead.job_title} ${lead.contact_name} ${lead.status}`.toLowerCase().includes(leadSearch.toLowerCase()));
  return <>
    <PageHeader eyebrow="CLIENT RELATIONSHIPS" title="Clients & hiring leads" description="Review client accounts, linked openings, and new employer inquiries." actions={<button className="button button-primary" onClick={onCreateClient}><Plus size={16} /> Add client</button>} />
    <section className="clients-grid">
      {clients.length ? clients.map(client => {
        const linked = clientJobs.get(client.id) || [];
        return <article className="panel client-card" key={client.id}>
          <div className="client-card-head"><span className="client-card-icon"><Building2 size={18} /></span><div><strong>{client.name}</strong><span>{client.website || "Website not provided"}</span></div></div>
          <div className="client-card-stats"><span><b>{linked.filter(item => item.status === "open").length}</b> open roles</span><span><b>{linked.length}</b> total roles</span></div>
          <div className="client-role-list">{linked.slice(0, 3).map(item => <div key={item.id}><span>{item.title}</span><small>{item.status}</small></div>)}{!linked.length && <small>No roles linked yet.</small>}</div>
          <button className="client-crm-open" onClick={() => setSelectedClient(client)}>Open client records <ArrowRight size={14} /></button>
        </article>;
      }) : <section className="panel clients-empty"><EmptyState icon={<Building2 size={20} />} title="No client accounts yet" body="Create a client record or qualify an employer inquiry below." action={<button className="button button-primary button-small" onClick={onCreateClient}><Plus size={14} /> Add first client</button>} /></section>}
    </section>
    {canManageLeads && <section className="panel employer-leads-panel">
      <div className="panel-header"><div><div className="eyebrow">INBOUND BUSINESS</div><h2>Employer inquiries</h2></div><span className="count-chip">{leads.filter(lead => lead.status === "new").length} new</span></div>
      <div className="table-toolbar"><div className="search-box"><Search size={15} /><input aria-label="Search hiring inquiries" placeholder="Search companies, roles, or contacts…" value={leadSearch} onChange={event => setLeadSearch(event.target.value)} /></div><span className="result-count">{visibleLeads.length} inquiries</span></div>
      {loading ? <div className="loading-inline"><LoaderCircle className="spin" /> Loading hiring inquiries…</div> : visibleLeads.length ? <div className="employer-lead-list">
        {visibleLeads.map(lead => (
          <article className="employer-lead-row" key={lead.id}>
            <div className="employer-lead-company"><strong>{lead.company_name}</strong><span>{lead.job_title} · {lead.vacancies} {lead.vacancies === 1 ? "position" : "positions"}</span><small>{lead.location} · {lead.hiring_timeline}</small></div>
            <div className="employer-lead-contact"><strong>{lead.contact_name}</strong><span>{lead.email} · {lead.phone}</span></div>
            <div className="employer-lead-actions"><select aria-label={`Lead status for ${lead.company_name}`} value={lead.status} disabled={lead.status === "converted"} onChange={event => updateLead(lead, event.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="declined">Declined</option><option value="converted" disabled>Converted</option></select>{lead.status === "qualified" && <button className="button button-primary button-small" onClick={() => convertLead(lead)}>Convert to client</button>}{lead.status === "converted" && <span className="lead-converted">Client record created</span>}</div>
          </article>
        ))}
      </div> : <EmptyState icon={<BriefcaseBusiness size={20} />} title="No employer inquiries yet" body="New hiring requests submitted through the public employer form will appear here." />}
    </section>}
    {selectedClient && <ClientCrmModal client={selectedClient} token={token} canManageContracts={MANAGER_ROLES_UI.includes(org.role)} onClose={() => setSelectedClient(null)} onError={onError} onToast={onToast} />}
  </>;
}

function JobsPage({ jobs, allCount, clients, search, setSearch, onOpenJob, onCreateJob, onCreateClient, canCreate }: { jobs: Job[]; allCount: number; clients: Client[]; search: string; setSearch: (s: string) => void; onOpenJob: (j: Job) => void; onCreateJob: () => void; onCreateClient: () => void; canCreate: boolean }) {
  const clientById = new Map(clients.map(item => [item.id, item.name]));
  const [filter, setFilter] = useState("all");
  const filtered = jobs.filter(item => filter === "all" || item.status === filter);
  return <>
    <PageHeader eyebrow="YOUR OPENINGS" title="Jobs" description={canCreate ? "Manage client roles, confirm requirements, and review applications." : "Review role descriptions and add sourced candidates."} actions={canCreate ? <><button className="button button-secondary" onClick={onCreateClient}><Building2 size={16} /> Add client</button><button className="button button-primary" onClick={onCreateJob}><Plus size={17} /> Create job</button></> : undefined} />
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search jobs" placeholder="Search roles or status…" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="toolbar-right"><span className="result-count">{filtered.length} of {allCount} roles</span><div className="select-wrap"><Filter size={15} /><select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter jobs"><option value="all">All statuses</option><option value="open">Open</option><option value="draft">Draft</option><option value="paused">Paused</option><option value="filled">Filled</option><option value="archived">Archived</option></select><ChevronDown size={14} /></div></div></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>ROLE</th><th>CLIENT</th><th>LOCATION</th><th>STATUS</th><th>ADDED</th><th /></tr></thead><tbody>{filtered.map(item => <tr key={item.id} onClick={() => onOpenJob(item)} className="clickable-row"><td><div className="role-cell"><div className="table-job-icon"><BriefcaseBusiness size={16} /></div><div><strong>{item.title}</strong><span>Job description {item.description ? "added" : "missing"}</span></div></div></td><td>{clientById.get(item.client_id || "") || <span className="muted">No client linked</span>}</td><td>{item.location || <span className="muted">—</span>}</td><td><span className={`job-status status-${item.status}`}>{item.status}</span></td><td>{dateLabel(item.created_at)}</td><td><button className="icon-button row-action" aria-label={`Open ${item.title}`}><ArrowRight size={16} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={<BriefcaseBusiness size={20} />} title={search || filter !== "all" ? "No jobs match these filters" : "Your first role starts here"} body={search || filter !== "all" ? "Adjust the search or status filter and try again." : canCreate ? "Add a client, paste the job description, and confirm a job-related rubric before scoring." : "No role descriptions are available in this workspace yet."} action={canCreate && !search && filter === "all" ? <button className="button button-primary button-small" onClick={onCreateJob}><Plus size={15} /> Create first job</button> : undefined} />}
    </section>
  </>;
}

function CandidatesPage({ candidates, total, search, setSearch, token, orgId, onRefresh, allowPrivacyRequest }: { candidates: Candidate[]; total: number; search: string; setSearch: (s: string) => void; token: string; orgId: string; onRefresh: () => Promise<void>; allowPrivacyRequest: boolean }) {
  const [selected, setSelected] = useState<any>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareRecords, setCompareRecords] = useState<any[]>([]);
  const [comparing, setComparing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [detailError, setDetailError] = useState("");
  async function open(candidate: Candidate) { setDetailError(""); try { setSelected(await api<any>(`/candidates/${candidate.id}`, token)); } catch (e) { setDetailError(noticeMessage(e)); } }
  async function resume(assetId?: string) { if (!selected) return; const tab = window.open("about:blank", "_blank"); if (!tab) { setDetailError("Allow pop-ups to open a private resume link."); return; } tab.opener = null; try { const result = await api<{url:string}>(`/candidates/${selected.id}/resume-url${assetId ? `?asset_id=${assetId}` : ""}`, token); tab.location.href = result.url; } catch (e) { tab.close(); setDetailError(noticeMessage(e)); } }
  async function addResumeVersion(file?: File) {
    if (!selected || !file) return;
    setUploadingResume(true); setDetailError("");
    const form = new FormData(); form.append("file", file);
    try {
      const result = await api<any>(`/candidates/${selected.id}/resumes`, token, { method: "POST", body: form });
      setSelected(await api<any>(`/candidates/${selected.id}`, token)); await onRefresh();
      if (result.warnings?.length) setDetailError(result.warnings.join(" "));
    } catch (error) { setDetailError(noticeMessage(error)); }
    finally { setUploadingResume(false); }
  }
  async function requestDeletion() {
    if (!selected) return;
    try {
      await api("/privacy-requests", token, { method: "POST", body: json({ org_id: selected.org_id, candidate_id: selected.id, request_type: "deletion", details: "Candidate profile deletion requested for administrative review." }) });
      setDetailError("Deletion request recorded. An owner or admin can review and fulfill it from Workspace settings.");
    } catch (e) { setDetailError(noticeMessage(e)); }
  }
  function toggleCompare(candidateId: string) {
    setCompareIds(current => current.includes(candidateId) ? current.filter(id => id !== candidateId) : current.length < 5 ? [...current, candidateId] : current);
    if (compareIds.length >= 5 && !compareIds.includes(candidateId)) setDetailError("Compare up to five candidates at a time.");
  }
  async function compareCandidates() {
    setComparing(true); setDetailError("");
    try { const results = await Promise.all(compareIds.map(id => api<any>(`/candidates/${id}`, token))); setCompareRecords(results); }
    catch (error) { setDetailError(noticeMessage(error)); }
    finally { setComparing(false); }
  }
  async function importCsv(file?: File) {
    if (!file) return;
    setImporting(true); setImportResult(null); setDetailError("");
    const form = new FormData(); form.append("file", file);
    try { const result = await api<any>(`/candidates/import.csv?org_id=${orgId}`, token, { method: "POST", body: form }); setImportResult(result); await onRefresh(); }
    catch (error) { setDetailError(noticeMessage(error)); }
    finally { setImporting(false); }
  }
  function downloadCsvTemplate() {
    const url = URL.createObjectURL(new Blob(["full_name,email,phone,current_title,current_employer,skills,source\r\n"], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mosahay-candidate-import-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <>
    <PageHeader eyebrow="TALENT RECORDS" title="Candidates" description="Search profiles, inspect resume evidence, and compare up to five candidates side by side." actions={<><button className="button button-secondary" onClick={downloadCsvTemplate}><ArrowDownToLine size={15} /> CSV template</button><label className={`button button-primary ${importing ? "is-disabled" : ""}`}><Plus size={15} />{importing ? "Importing…" : "Import CSV"}<input className="file-input" type="file" accept=".csv,text/csv" disabled={importing} onChange={event => { void importCsv(event.target.files?.[0]); event.target.value = ""; }} /></label>{compareIds.length > 1 && <button className="button button-secondary" disabled={comparing} onClick={compareCandidates}><Users size={15} />{comparing ? "Loading…" : `Compare ${compareIds.length}`}</button>}</>} />
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16} /><input placeholder="Search name, role, employer, or skill…" value={search} onChange={e => setSearch(e.target.value)} /></div><span className="result-count">{compareIds.length}/5 selected · {candidates.length} shown · {total} total</span></div>
      {importResult && <div className="notice notice-info small-notice"><span>CSV import: {importResult.imported} profile{importResult.imported === 1 ? "" : "s"} added, {importResult.duplicate_review} duplicate warning{importResult.duplicate_review === 1 ? "" : "s"}, {importResult.failed} failed row{importResult.failed === 1 ? "" : "s"}. Profiles imported without a resume stay unscored until resume evidence is available.</span>{importResult.results?.filter((item: any) => item.status !== "imported" || item.warning).slice(0, 8).map((item: any) => <small className="csv-import-row" key={`${item.row}-${item.candidate_id || item.status}`}>Row {item.row}: {item.warning || item.error || "Possible duplicate. Review before import."}</small>)}</div>}
      {detailError && !selected && <div className="notice notice-error small-notice">{detailError}</div>}
      {candidates.length ? <div className="table-scroll"><table><thead><tr><th>COMPARE</th><th>CANDIDATE</th><th>RECENT ROLE</th><th>PARSE STATUS</th><th>SOURCE</th><th>ADDED</th><th /></tr></thead><tbody>{candidates.map(item => <tr key={item.id} className="clickable-row" onClick={() => open(item)}><td><input type="checkbox" aria-label={`Select ${item.full_name || "candidate"} for comparison`} checked={compareIds.includes(item.id)} onClick={event => event.stopPropagation()} onChange={() => toggleCompare(item.id)} /></td><td><div className="candidate-cell"><div className="avatar avatar-candidate">{initials(item.full_name)}</div><div><strong>{item.full_name || "Name not extracted"}</strong><span>Candidate record</span></div></div></td><td>{item.current_title || <span className="muted">Not supplied</span>}</td><td><span className={`parse-badge ${item.parse_status === "parsed" ? "parse-ok" : "parse-review"}`}><span />{item.parse_status?.replaceAll("_", " ") || "Pending"}</span></td><td>{item.source || "—"}</td><td>{dateLabel(item.created_at)}</td><td><ArrowRight size={15} className="row-arrow" /></td></tr>)}</tbody></table></div> : <EmptyState icon={<Users size={20} />} title={search ? "No candidate matches" : "No candidate records yet"} body={search ? "Try a different name or role." : "Upload resumes from a job’s detail page. Each file is processed independently."} />}</section>
    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="drawer" onClick={e => e.stopPropagation()}><div className="drawer-head"><div><div className="eyebrow">CANDIDATE PROFILE</div><h2>{selected.full_name || "Candidate"}</h2></div><button className="icon-button" aria-label="Close profile" onClick={() => setSelected(null)}><X size={18} /></button></div>{detailError && <div className="notice notice-error">{detailError}</div>}<div className="profile-person"><div className="avatar avatar-large">{initials(selected.full_name)}</div><div><strong>{selected.current_title || "Recent title not recorded"}</strong><span>{selected.current_employer || "Employer not recorded"}</span></div></div><div className="profile-section"><h3>Resume details</h3><dl className="detail-list"><div><dt>Email</dt><dd>{selected.email || "Not extracted"}</dd></div><div><dt>Phone</dt><dd>{selected.phone || "Not extracted"}</dd></div><div><dt>Source</dt><dd>{selected.source || "Not recorded"}</dd></div><div><dt>Privacy notice</dt><dd>{selected.privacy_notice_version || "Not recorded"} · {selected.consent_status?.replaceAll("_", " ")}</dd></div></dl></div><div className="profile-section"><h3>Skills extracted</h3><div className="skill-tags">{(selected.skills || []).length ? selected.skills.map((skill: string) => <span key={skill}>{skill}</span>) : <span className="muted">No skills extracted</span>}</div>{(selected.parsing_warnings || []).map((warning: string) => <div className="notice notice-warning small-notice" key={warning}><AlertTriangle size={15} />{warning}</div>)}</div><div className="profile-section"><h3>Work history evidence</h3>{(selected.parsed_profile?.experiences || []).length ? selected.parsed_profile.experiences.map((item: any, index: number) => <div className="profile-evidence" key={index}><strong>{item.title || "Role not extracted"}{item.employer ? " · " + item.employer : ""}</strong><span>{item.start_date || "Date not recorded"} – {item.is_current ? "Present" : item.end_date || "Date not recorded"}</span><p>{item.evidence_quote}</p></div>) : <span className="muted">No date-supported work history was extracted.</span>}</div><div className="profile-section"><h3>Education evidence</h3>{(selected.parsed_profile?.educations || []).length ? selected.parsed_profile.educations.map((item: any, index: number) => <div className="profile-evidence" key={index}><p>{item.evidence_quote}</p></div>) : <span className="muted">No education details were extracted.</span>}</div><div className="profile-section"><h3>Applications</h3>{selected.applications?.length ? selected.applications.map((item: any) => <div className="linked-app" key={item.id}><div><strong>{item.jobs?.title || "Role"}</strong><span>{item.stage}</span></div><span>{dateLabel(item.created_at)}</span></div>) : <span className="muted">No applications linked</span>}</div><div className="profile-section"><h3>Resume versions</h3>{selected.resume_assets?.length ? selected.resume_assets.map((asset: any) => <div className="linked-app" key={asset.id}><div><strong>{asset.original_filename}</strong><span>{asset.parse_status?.replaceAll("_", " ")} · {dateLabel(asset.created_at)}</span></div><button className="text-button" onClick={() => resume(asset.id)}>Open</button></div>) : <span className="muted">No resume version attached yet.</span>}</div><label className={`button button-secondary button-full ${uploadingResume ? "is-disabled" : ""}`}><Plus size={15} />{uploadingResume ? "Uploading…" : "Add resume version"}<input className="file-input" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={uploadingResume} onChange={event => { void addResumeVersion(event.target.files?.[0]); event.target.value = ""; }} /></label>{allowPrivacyRequest && !selected.deleted_at && <button className="button button-ghost button-full deletion-request-button" onClick={requestDeletion}>Record a deletion request</button>}</aside></div>}
    {compareRecords.length > 1 && <div className="modal-backdrop compare-backdrop" onClick={() => setCompareRecords([])}><section className="modal modal-wide compare-modal compare-print" onClick={event => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">SIDE-BY-SIDE REVIEW</div><h2>Candidate comparison</h2><p>Scores are evidence summaries from each candidate’s latest application. Compare evidence and make a human-led decision.</p></div><div className="compare-modal-actions"><button className="button button-secondary button-small" onClick={() => window.print()}>Print comparison</button><button className="icon-button" aria-label="Close comparison" onClick={() => setCompareRecords([])}><X size={18} /></button></div></div><div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>Evidence</th>{compareRecords.map(record => <th key={record.id}>{record.full_name || "Candidate"}</th>)}</tr></thead><tbody>{[
      ["Current role", (row: any) => row.current_title || "Not recorded"],
      ["Current employer", (row: any) => row.current_employer || "Not recorded"],
      ["Estimated experience", (row: any) => row.parsed_profile?.approximate_experience_years != null ? `${row.parsed_profile.approximate_experience_years} years` : "Unknown"],
      ["Skills", (row: any) => (row.skills || []).join(", ") || "Not extracted"],
      ["Education evidence", (row: any) => (row.parsed_profile?.educations || []).map((entry: any) => entry.evidence_quote).filter(Boolean).join("; ") || "Not extracted"],
      ["Latest job match", (row: any) => (row.applications || []).filter((item: any) => item.latest_score).map((item: any) => `${item.jobs?.title || "Role"}: ${item.latest_score.total_score ?? "Insufficient evidence"}/100 (${item.latest_score.evidence_coverage}% coverage)`).join("; ") || "No score run"],
      ["Application stage", (row: any) => (row.applications || []).map((item: any) => `${item.jobs?.title || "Role"}: ${item.stage}`).join("; ") || "No application"],
      ["Resume parsing", (row: any) => row.parse_status?.replaceAll("_", " ") || "Unknown"],
    ].map(([label, render]) => <tr key={String(label)}><th>{label as string}</th>{compareRecords.map(record => <td key={record.id}>{(render as (value: any) => string)(record)}</td>)}</tr>)}</tbody></table></div><p className="compare-disclaimer">Missing information stays unknown. Do not infer protected or sensitive characteristics from candidate data.</p></section></div>}
  </>;
}

function PipelinePage({ jobs, token, onOpenJob }: { jobs: Job[]; token: string; onOpenJob: (j: Job) => void }) {
  const [selectedJob, setSelectedJob] = useState("");
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { const target = selectedJob || jobs[0]?.id; if (!target) { setItems([]); return; } setSelectedJob(target); setLoading(true); api<Application[]>(`/jobs/${target}/applications?limit=100`, token).then(setItems).catch(() => setItems([])).finally(() => setLoading(false)); }, [selectedJob, jobs, token]);
  async function move(item: Application, stage: string) { const decision_reason = ["Hired", "Rejected", "Withdrawn"].includes(stage) ? window.prompt(`Record the human decision reason for ${stage.toLowerCase()}:`) : undefined; if (["Hired", "Rejected", "Withdrawn"].includes(stage) && !decision_reason?.trim()) return; try { await api(`/applications/${item.id}/stage`, token, { method: "PATCH", body: json({ stage, decision_reason }) }); setItems(old => old.map(row => row.id === item.id ? { ...row, stage } : row)); } catch (e) { window.alert(noticeMessage(e)); } }
  return <><PageHeader eyebrow="HIRING WORKFLOW" title="Pipeline" description="Track applications by stage. Every move is recorded and remains under recruiter control." actions={jobs.length > 0 ? <div className="select-wrap job-select"><BriefcaseBusiness size={15} /><select value={selectedJob || jobs[0]?.id} onChange={e => setSelectedJob(e.target.value)}>{jobs.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={14} /></div> : undefined} />
    {jobs.length === 0 ? <section className="panel"><EmptyState icon={<Activity size={20} />} title="No roles to track" body="Create a job to start a hiring pipeline." /></section> : loading ? <div className="loading-inline"><LoaderCircle className="spin" /> Loading applications…</div> : <section className="pipeline-board">{stages.map((stage, i) => { const rows = items.filter(item => item.stage === stage); return <div className="pipeline-column" key={stage}><div className="pipeline-column-head"><span className={`pipeline-stage-dot p-dot-${i % 5}`} /><strong>{stage}</strong><span className="pipeline-count">{rows.length}</span></div><div className="pipeline-cards">{rows.map(item => <article className="pipeline-card" key={item.id}><button className="pipeline-card-title" onClick={() => onOpenJob(jobs.find(j => j.id === (item as any).job_id) || jobs.find(j => j.id === selectedJob) || jobs[0])}>{item.candidates?.full_name || "Name not extracted"}</button><span>{item.candidates?.current_title || "Role not extracted"}</span><div className="pipeline-card-foot"><span>{dateLabel(item.created_at)}</span><select aria-label={`Move ${item.candidates?.full_name || "candidate"}`} value={item.stage} onChange={e => move(item, e.target.value)}>{stages.map(s => <option key={s}>{s}</option>)}</select></div></article>)}</div></div>; })}</section>}
  </>;
}

function ReportsPage({ org, metrics, token }: { org: Workspace; metrics: any; token: string }) {
  const [error, setError] = useState("");
  const [report, setReport] = useState<any>(null);
  useEffect(() => { api<any>(`/analytics/pipeline?org_id=${org.id}`, token).then(setReport).catch(e => setError(noticeMessage(e))); }, [org.id, token]);
  async function exportCsv() { setError(""); try { const csv = await api<string>(`/analytics/export.csv?org_id=${org.id}`, token); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "mosahay-recruitos-applications.csv"; a.click(); URL.revokeObjectURL(url); } catch (e) { setError(noticeMessage(e)); } }
  const sources = Object.entries(report?.source_counts || {}) as [string, number][];
  const stageAges = Object.entries(report?.average_days_in_current_stage || {}) as [string, number][];
  return <><PageHeader eyebrow="WORKSPACE INSIGHTS" title="Reports" description="Review application flow and export authorized workspace data." actions={<button className="button button-secondary" onClick={exportCsv}><ArrowDownToLine size={16} /> Export CSV</button>} />{error && <div className="notice notice-error">{error}</div>}{report?.truncated && <div className="notice notice-info">Showing the most recent 5,000 applications; older records are outside this report window.</div>}<div className="report-grid"><section className="panel report-main"><div className="panel-header"><div><div className="eyebrow">APPLICATIONS BY STAGE</div><h2>Hiring flow</h2></div><span className="subtle-icon">{report?.total ?? metrics?.candidate_count ?? 0} applications</span></div><div className="stage-bars">{stages.map((stage, i) => { const count = report?.by_stage?.[stage] ?? metrics?.stage_counts?.[stage] ?? 0; const max = Math.max(1, ...Object.values(report?.by_stage || metrics?.stage_counts || {}).map(Number)); return <div className="stage-bar-row" key={stage}><span>{stage}</span><div className="stage-track"><div className={`stage-fill fill-${i % 5}`} style={{ width: `${count ? Math.max(5, count / max * 100) : 0}%` }} /></div><strong>{count}</strong></div>; })}</div></section><section className="panel report-side"><div className="eyebrow">TIME TO FILL</div><div className="report-total">{report?.average_time_to_fill_days == null ? "—" : `${report.average_time_to_fill_days}d`}</div><h3>Average days to hire</h3><p>{report?.completed_hires ?? 0} completed hire{report?.completed_hires === 1 ? "" : "s"} with available timestamps.</p><div className="report-note"><ShieldCheck size={16} /><span>Exports include candidate names and role history. Handle files under your agency’s privacy policy.</span></div></section></div><div className="report-grid"><section className="panel report-main"><div className="panel-header"><div><div className="eyebrow">CURRENT STAGE AGE</div><h2>Average days in stage</h2></div></div>{stageAges.length ? <div className="stage-bars">{stageAges.map(([stage, days], i) => <div className="stage-bar-row" key={stage}><span>{stage}</span><div className="stage-track"><div className={`stage-fill fill-${i % 5}`} style={{ width: `${Math.max(5, days / Math.max(1, ...stageAges.map(([, value]) => value)) * 100)}%` }} /></div><strong>{days}d</strong></div>)}</div> : <p className="muted">No stage timing records yet.</p>}</section><section className="panel report-side"><div className="eyebrow">CANDIDATE SOURCES</div><h2>Source tracking</h2>{sources.length ? sources.map(([source, count], i) => <div className="stage-bar-row" key={source}><span>{source.replaceAll("_", " ")}</span><div className="stage-track"><div className={`stage-fill fill-${i % 5}`} style={{ width: `${Math.max(5, count / Math.max(1, ...sources.map(([, value]) => value)) * 100)}%` }} /></div><strong>{count}</strong></div>) : <p className="muted">No source records yet.</p>}</section></div><section className="panel report-foot"><div className="report-foot-icon"><BriefcaseBusiness size={18} /></div><div><strong>Pipeline by job</strong>{report?.by_job?.length ? report.by_job.map((item: any) => <div key={item.job_id}><strong>{item.title}</strong><span>{item.total} applications · {Object.entries(item.by_stage).filter(([, count]) => count).map(([stage, count]) => `${stage}: ${count}`).join(" · ")}</span></div>) : <p>No job applications to report.</p>}</div></section></>;
}

function SettingsPage({ org, token, settings, members, requests, auditLogs, currentUserId, googleLinked, onRefresh, onToast }: { org: Workspace; token: string; settings: any; members: any[]; requests: any[]; auditLogs: any[]; currentUserId: string; googleLinked: boolean; onRefresh: () => Promise<void>; onToast: (s: string) => void }) {
  const canManage = org.role === "owner" || org.role === "admin";
  const canWrite = canManage || org.role === "recruiter";
  const [name, setName] = useState(settings?.name || org.name);
  const [notice, setNotice] = useState(settings?.privacy_notice_text || "");
  const [retention, setRetention] = useState(String(settings?.retention_days || 730));
  const [aiEnabled, setAiEnabled] = useState(Boolean(settings?.ai_processing_enabled));
  const [aiNoticeAck, setAiNoticeAck] = useState(Boolean(settings?.ai_notice_acknowledged));
  const [requestType, setRequestType] = useState("access");
  const [requestDetails, setRequestDetails] = useState("");
  const [localError, setLocalError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("recruiter");
  const [inviteUrl, setInviteUrl] = useState("");
  const [invitations, setInvitations] = useState<any[]>([]);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleConfigChecked, setGoogleConfigChecked] = useState(false);
  useEffect(() => {
    if (token !== "mongo-cookie") return;
    fetch(`${apiBase()}/auth/config`, { cache: "no-store", credentials: "include" })
      .then(response => response.json())
      .then(config => setGoogleEnabled(Boolean(config.google_enabled)))
      .catch(() => setGoogleEnabled(false))
      .finally(() => setGoogleConfigChecked(true));
  }, [token]);
  useEffect(() => {
    if (canManage && token === "mongo-cookie") api<any[]>(`/organizations/${org.id}/invitations`, token).then(setInvitations).catch(e => setLocalError(noticeMessage(e)));
  }, [canManage, org.id, token]);
  useEffect(() => {
    setName(settings?.name || org.name);
    setNotice(settings?.privacy_notice_text || "");
    setRetention(String(settings?.retention_days || 730));
    setAiEnabled(Boolean(settings?.ai_processing_enabled));
    setAiNoticeAck(Boolean(settings?.ai_notice_acknowledged));
  }, [settings, org.name]);
  async function save() {
    setLocalError("");
    try {
      await api("/organizations/" + org.id, token, { method: "PATCH", body: json({
        name, privacy_notice_text: notice, retention_days: Number(retention),
        ai_processing_enabled: aiEnabled, ai_notice_acknowledged: aiEnabled && aiNoticeAck,
      }) });
      await onRefresh(); onToast("Workspace settings saved");
    } catch (e) { setLocalError(noticeMessage(e)); }
  }
  async function updateMemberRole(userId: string, role: string) {
    setLocalError("");
    try {
      await api("/organizations/" + org.id + "/members/" + userId, token, { method: "PATCH", body: json({ role }) });
      await onRefresh(); onToast("Member role updated");
    } catch (e) { setLocalError(noticeMessage(e)); }
  }
  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError(""); setCreatingInvite(true);
    try {
      const invite = await api<any>(`/organizations/${org.id}/invitations`, token, { method: "POST", body: json({ email: inviteEmail, role: inviteRole }) });
      setInviteUrl(invite.invite_url); setInvitations(old => [invite, ...old]); setInviteEmail(""); onToast("Team invite created. Copy the link to share it.");
    } catch (e) { setLocalError(noticeMessage(e)); }
    finally { setCreatingInvite(false); }
  }
  async function copyInvitation() {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); onToast("Invitation link copied"); }
    catch { setLocalError("The link could not be copied. Select and copy it manually."); }
  }
  function linkGoogle() { window.location.assign(`${apiBase()}/auth/google/link`); }
  async function createPrivacyRequest() {
    setLocalError("");
    try {
      await api("/privacy-requests", token, { method: "POST", body: json({ org_id: org.id, request_type: requestType, details: requestDetails }) });
      setRequestDetails(""); await onRefresh(); onToast("Privacy request recorded");
    } catch (e) { setLocalError(noticeMessage(e)); }
  }
  async function fulfillDeletion(requestId: string) {
    if (!window.confirm("This anonymizes the candidate profile, removes private resumes, redacts score evidence, and removes notes and interview feedback. Continue?")) return;
    setLocalError("");
    try {
      await api("/privacy-requests/" + requestId + "/fulfill-deletion", token, { method: "POST" });
      await onRefresh(); onToast("Deletion request fulfilled");
    } catch (e) { setLocalError(noticeMessage(e)); }
  }
  return <>
    <PageHeader eyebrow="WORKSPACE CONTROLS" title="Settings" description="Manage operational defaults, privacy notice, retention, and access visibility." />
    {localError && <div className="notice notice-error">{localError}</div>}
    <div className="settings-grid">
      <section className="panel settings-panel">
        <div className="panel-header"><div><div className="eyebrow">WORKSPACE PROFILE</div><h2>Agency defaults</h2></div><Settings2 size={18} className="subtle-icon" /></div>
        <label className="field-label">Workspace name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} disabled={!canManage} />
        <label className="field-label space-top">Candidate privacy notice</label>
        <textarea className="textarea" rows={5} value={notice} onChange={e => setNotice(e.target.value)} disabled={!canManage} />
        <div className="field-hint">Shown to recruiters during candidate intake. Notice delivery is recorded separately; an upload is not consent.</div>
        <label className="field-label space-top">Default retention (days)</label>
        <input className="input short-input" type="number" min={1} max={3650} value={retention} onChange={e => setRetention(e.target.value)} disabled={!canManage} />
        <div className="ai-settings">
          <label className="confirm-rubric"><input type="checkbox" checked={aiEnabled} onChange={e => setAiEnabled(e.target.checked)} disabled={!canManage} /><span>Enable optional AI resume fact extraction for this workspace</span></label>
          {aiEnabled && <label className="confirm-rubric"><input type="checkbox" checked={aiNoticeAck} onChange={e => setAiNoticeAck(e.target.checked)} disabled={!canManage} /><span>I reviewed the active privacy notice and it explains AI/model-provider processing.</span></label>}
          <p>AI requires API configuration, an active notice that mentions AI or its provider, and the recruiter recording notice delivery for each upload. Scores remain deterministic.</p>
        </div>
        <button className="button button-primary" onClick={save} disabled={!canManage}><Check size={16} /> Save settings</button>
      </section>
      <section className="panel settings-panel">
        <div className="panel-header"><div><div className="eyebrow">ACCESS & PRIVACY</div><h2>Workspace members</h2></div><span className="count-chip">{members.length}</span></div>
        <p className="settings-description">Invite teammates to a private workspace and assign their role before they join.</p>
        {members.length ? <div className="member-list">{members.map(member => <div className="member-row" key={member.id}><div className="avatar avatar-member">{initials(member.name || member.email || member.user_id)}</div><div><strong>{member.user_id === currentUserId ? "You" : member.name || member.email || "Workspace member"}</strong><span>{member.email || "Team account"} · added {dateLabel(member.created_at)}</span></div>{canManage && member.role !== "owner" ? <select className="role-select" aria-label={"Role for member " + member.user_id.slice(0, 8)} value={member.role} onChange={e => updateMemberRole(member.user_id, e.target.value)}><option value="admin">Admin</option><option value="recruitment_manager">Recruitment Manager</option><option value="recruiter">Recruiter</option><option value="sourcer">Sourcer</option><option value="finance">Finance</option><option value="reviewer">Reviewer</option></select> : <span className={"role-pill role-" + member.role}>{member.role}</span>}</div>)}</div> : <div className="muted">No workspace members yet.</div>}
        <div className="team-invite-box"><h3>Invite a teammate</h3>{token === "mongo-cookie" ? <><form className="team-invite-form" onSubmit={createInvitation}><input className="input" type="email" placeholder="teammate@company.com" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} disabled={!canManage} /><select className="input" value={inviteRole} onChange={e => setInviteRole(e.target.value)} disabled={!canManage}><option value="admin">Admin</option><option value="recruitment_manager">Recruitment manager</option><option value="recruiter">Recruiter</option><option value="sourcer">Sourcer</option><option value="finance">Finance</option><option value="reviewer">Reviewer</option></select><button className="button button-secondary" type="submit" disabled={!canManage || creatingInvite}>{creatingInvite ? "Creating…" : "Create invite"}</button></form>{inviteUrl && <div className="invite-link-row"><input className="input" readOnly value={inviteUrl} aria-label="Team invitation link" /><button className="button button-secondary" type="button" onClick={copyInvitation}>Copy link</button></div>}<div className="field-hint">Invite links expire after 7 days. Share them directly with the invited work email; email delivery is not configured.</div>{invitations.filter(invite => !invite.accepted_at).slice(0, 5).map(invite => <div className="invite-pending" key={invite.id}>{invite.email} · {invite.role.replaceAll("_", " ")} · expires {dateLabel(invite.expires_at)}</div>)}</> : <div className="field-hint">Connect MongoDB to create secure team invitation links.</div>}</div>
        <div className="team-invite-box"><h3>Connected accounts</h3><div className="connected-account-row"><div><strong>Google</strong><span>{googleLinked ? "Linked to your verified work email" : "Sign in more quickly with your Google account"}</span></div>{googleLinked ? <span className="role-pill role-owner">Connected</span> : token === "mongo-cookie" ? <button className="button button-secondary" type="button" onClick={linkGoogle} disabled={!googleConfigChecked || !googleEnabled} title={!googleEnabled ? "Configure Google OAuth on the API service to enable linking." : undefined}>{googleEnabled ? "Link Google account" : "Google setup required"}</button> : <span className="field-hint">Available after MongoDB setup</span>}</div>{token === "mongo-cookie" && !googleEnabled && <div className="field-hint">Linking will be enabled after GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured.</div>}</div>
        <div className="privacy-requests">
          <h3>Privacy request register</h3>
          {canWrite && <div className="privacy-request-form"><select className="input" value={requestType} onChange={e => setRequestType(e.target.value)}><option value="access">Access</option><option value="correction">Correction</option><option value="export">Export</option><option value="consent_withdrawal">Consent withdrawal</option><option value="deletion">Deletion</option></select><textarea className="textarea" rows={2} placeholder="Describe the request (avoid adding unnecessary personal details)" value={requestDetails} onChange={e => setRequestDetails(e.target.value)} /><button className="button button-secondary" disabled={requestDetails.trim().length < 3} onClick={createPrivacyRequest}><Plus size={15} /> Record request</button></div>}
          <div className="privacy-request-list">{requests.slice(0, 5).map(item => <div className="privacy-item" key={item.id}><span className="request-type">{item.request_type?.replaceAll("_", " ")}</span><span>{dateLabel(item.created_at)}</span><span className={"request-status req-" + item.status}>{item.status}</span>{canManage && item.request_type === "deletion" && item.status !== "completed" && item.candidate_id ? <button className="text-button fulfill-button" onClick={() => fulfillDeletion(item.id)}>Fulfill</button> : null}</div>)}{!requests.length && <span className="muted">No visible requests.</span>}</div>
        </div>
        <div className="privacy-requests audit-section">
          <h3>Audit history</h3><p className="settings-description">Append-only administrative and candidate workflow events. Sensitive resume text is never stored here.</p>
          <div className="privacy-request-list">{auditLogs.slice(0, 10).map(item => <div className="privacy-item" key={item.id}><span className="request-type">{item.action?.replaceAll("_", " ")}</span><span>{item.entity_type}</span><span>{dateLabel(item.created_at)}</span></div>)}{!auditLogs.length && <span className="muted">No visible audit activity.</span>}</div>
        </div>
      </section>
    </div>
  </>;
}

function ClientModal({ org, token, onClose, onSaved, onError }: { org: Workspace; token: string; onClose: () => void; onSaved: () => Promise<void>; onError: (s: string) => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof clientSchema>>({ resolver: zodResolver(clientSchema) });
  const submit = async (values: z.infer<typeof clientSchema>) => { try { await api("/clients", token, { method: "POST", body: json({ ...values, org_id: org.id }) }); await onSaved(); } catch (e) { onError(noticeMessage(e)); } };
  return <Modal title="Add a client" description="Create the company you are recruiting for." onClose={onClose}><form className="stack-form" onSubmit={handleSubmit(submit)}><label className="field-label">Client name</label><input className="input" placeholder="Company name" {...register("name")} />{errors.name && <span className="field-error">{errors.name.message}</span>}<label className="field-label">Website <span className="optional">Optional</span></label><input className="input" placeholder="https://company.example" {...register("website")} /><label className="field-label">Internal notes <span className="optional">Optional</span></label><textarea className="textarea" rows={3} {...register("notes")} /><div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Add client"}</button></div></form></Modal>;
}

function JobModal({ org, clients, token, onClose, onSaved, onError }: { org: Workspace; clients: Client[]; token: string; onClose: () => void; onSaved: (id: string) => Promise<void>; onError: (s: string) => void }) {
  const [status, setStatus] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<z.input<typeof jobSchema>, unknown, z.output<typeof jobSchema>>({ resolver: zodResolver(jobSchema), defaultValues: { work_arrangement: "not_specified", employment_type: "full_time" } });
  const submit = async (values: z.output<typeof jobSchema>) => {
    setStatus("");
    try {
      const description = jdFile ? "Job description text will be extracted from the attached file." : values.description;
      const row = await api<Job>("/jobs", token, { method: "POST", body: json({ ...values, description, org_id: org.id, status: "draft" }) });
      if (jdFile) {
        const form = new FormData(); form.append("file", jdFile);
        await api("/jobs/" + row.id + "/jd-file", token, { method: "POST", body: form });
      }
      const current = await api<Job>("/jobs/" + row.id, token);
      const suggestions = await api<any>("/jobs/" + row.id + "/parse-jd", token, { method: "POST", body: json({ text: current.description }) });
      setStatus("Draft created. " + (suggestions.proposed_requirements?.length || 0) + " requirement suggestions are ready for recruiter review.");
      await onSaved(row.id);
    } catch (e) { onError(noticeMessage(e)); }
  };
  function chooseFile(file?: File) {
    setJdFile(file || null);
    if (file) setValue("description", "Attached job description file will be extracted.");
    else setValue("description", "");
  }
  return <Modal title="Create a job" description="Paste a job description or upload a PDF, DOCX, or TXT file. The role stays in draft while you review the details." onClose={onClose} wide>
    <form className="job-form" onSubmit={handleSubmit(submit)}>
      <div className="form-two">
        <div><label className="field-label">Role title</label><input className="input" placeholder="Senior Product Designer" {...register("title")} />{errors.title && <span className="field-error">{errors.title.message}</span>}</div>
        <div><label className="field-label">Client</label><select className="input" {...register("client_id")}><option value="">Select a client</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select>{clients.length === 0 && <span className="field-hint">Add a client before creating the role if you want it linked.</span>}</div>
        <div><label className="field-label">Location <span className="optional">Optional</span></label><input className="input" placeholder="City or region" {...register("location")} /></div>
        <div><label className="field-label">Work arrangement</label><select className="input" {...register("work_arrangement")}><option value="not_specified">Not specified</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On site</option></select></div>
        <div><label className="field-label">Employment type</label><select className="input" {...register("employment_type")}><option value="full_time">Full time</option><option value="contract">Contract</option><option value="part_time">Part time</option><option value="temporary">Temporary</option></select></div>
        <div><label className="field-label">Industry <span className="optional">Optional</span></label><input className="input" placeholder="Manufacturing, technology…" {...register("industry")} /></div>
        <div><label className="field-label">Department <span className="optional">Optional</span></label><input className="input" placeholder="Operations, sales…" {...register("department")} /></div>
        <div><label className="field-label">Open positions <span className="optional">Optional</span></label><input className="input" type="number" min="1" max="10000" step="1" {...register("vacancies")} />{errors.vacancies && <span className="field-error">{errors.vacancies.message}</span>}</div>
        <div><label className="field-label">Application deadline <span className="optional">Optional</span></label><input className="input" type="date" {...register("application_deadline")} /></div>
        <div><label className="field-label">Minimum annual salary (INR) <span className="optional">Optional</span></label><input className="input" type="number" min="0" step="1000" {...register("salary_min")} /></div>
        <div><label className="field-label">Maximum annual salary (INR) <span className="optional">Optional</span></label><input className="input" type="number" min="0" step="1000" {...register("salary_max")} />{errors.salary_max && <span className="field-error">{errors.salary_max.message}</span>}</div>
        <div><label className="field-label">Minimum experience (years) <span className="optional">Optional</span></label><input className="input" type="number" min="0" max="100" step="0.5" {...register("experience_min")} /></div>
        <div><label className="field-label">Maximum experience (years) <span className="optional">Optional</span></label><input className="input" type="number" min="0" max="100" step="0.5" {...register("experience_max")} />{errors.experience_max && <span className="field-error">{errors.experience_max.message}</span>}</div>
      </div>
      <div>
        <label className="field-label">Job description</label>
        <textarea className="textarea jd-textarea" placeholder="Paste the job description…" {...register("description")} />
        {errors.description && !jdFile && <span className="field-error">{errors.description.message}</span>}
        <div className="jd-file-row"><label className="button button-secondary button-small"><FileText size={14} />{jdFile ? "Replace JD file" : "Or upload a JD file"}<input className="file-input" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={e => chooseFile(e.target.files?.[0])} /></label>{jdFile && <><span>{jdFile.name}</span><button type="button" className="text-button" onClick={() => chooseFile()}>Remove file</button></>}</div>
        <div className="field-hint">Text extraction proposes fields for review. It does not create approved criteria or scores on its own.</div>
      </div>
      <div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={isSubmitting}>{isSubmitting ? "Creating role…" : "Create draft job"}<ArrowRight size={15} /></button></div>
      {status && <div className="notice notice-info">{status}</div>}
    </form>
  </Modal>;
}

function JobDetail({ job, clients, applications, members, token, org, privacyNoticeText, onBack, onUpdate, onScore, onStage, onScorecard, onToast, onError }: { job: Job; clients: Client[]; applications: Application[]; members: any[]; token: string; org: Workspace; privacyNoticeText: string; onBack: () => void; onUpdate: () => Promise<void>; onScore: (a: Application) => Promise<void>; onStage: (a: Application, s: string) => Promise<void>; onScorecard: (a: Application) => void; onToast: (s: string) => void; onError: (s: string) => void }) {
  const [detail, setDetail] = useState<Job>(job);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<any>(null);
  const [parsedJd, setParsedJd] = useState<any>(null);
  const [rubricConfirmed, setRubricConfirmed] = useState(false);
  const [noticeStatus, setNoticeStatus] = useState("not_recorded");
  const [applicationSort, setApplicationSort] = useState("created_at");
  const [applicationStage, setApplicationStage] = useState("all");
  const [weights, setWeights] = useState<number[]>([40, 25, 20, 10, 5]);
  const [interviewQuestionText, setInterviewQuestionText] = useState("");
  const [assignedReviewers, setAssignedReviewers] = useState<any[]>([]);
  const [availableReviewers, setAvailableReviewers] = useState<any[]>([]);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [invitingReviewer, setInvitingReviewer] = useState(false);
  const [reviewerInviteUrl, setReviewerInviteUrl] = useState("");
  const [bulkScoring, setBulkScoring] = useState(false);
  const canManageJob = ["owner", "admin", "recruitment_manager", "recruiter"].includes(org.role);
  const canAssignReviewers = org.role === "owner" || org.role === "admin";
  useEffect(() => { setDetail(job); api<Job>(`/jobs/${job.id}`, token).then(setDetail).catch(e => onError(noticeMessage(e))); }, [job, token, onError]);
  useEffect(() => {
    if (!canAssignReviewers) return;
    Promise.all([api<any[]>(`/jobs/${job.id}/reviewers`, token), api<any[]>(`/organizations/${org.id}/members`, token)])
      .then(([assigned, members]) => { setAssignedReviewers(assigned); setAvailableReviewers(members.filter(member => member.role === "reviewer")); })
      .catch(e => onError(noticeMessage(e)));
  }, [job.id, org.id, token, canAssignReviewers, onError]);
  useEffect(() => {
    api<{ questions: string[] }>(`/jobs/${job.id}/interview-questions`, token)
      .then(result => setInterviewQuestionText(result.questions.join("\n")))
      .catch(e => onError(noticeMessage(e)));
  }, [job.id, token, onError]);
  const weightTotal = weights.reduce((sum, item) => sum + item, 0);
  const visibleApplications = [...applications].filter(app => applicationStage === "all" || app.stage === applicationStage).sort((a, b) => {
    if (applicationSort === "score") return (b.latest_score?.total_score ?? -1) - (a.latest_score?.total_score ?? -1);
    if (applicationSort === "coverage") return (b.latest_score?.evidence_coverage ?? -1) - (a.latest_score?.evidence_coverage ?? -1);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  async function parseJd() { try { const value = await api<any>(`/jobs/${detail.id}/parse-jd`, token, { method: "POST", body: json({ text: detail.description }) }); setParsedJd(value); } catch (e) { onError(noticeMessage(e)); } }
  async function saveStatus(status: string) { try { const updated = await api<Job>(`/jobs/${detail.id}`, token, { method: "PATCH", body: json({ status }) }); setDetail({ ...detail, ...updated }); onToast("Job status updated"); } catch (e) { onError(noticeMessage(e)); } }
  async function togglePublicListing(enabled: boolean) { try { const updated = await api<Job>(`/jobs/${detail.id}/public-listing`, token, { method: "PATCH", body: json({ enabled }) }); setDetail({ ...detail, public_slug: updated.public_slug, public_listing_enabled: updated.public_listing_enabled }); onToast(enabled ? "Public careers listing is live" : "Public careers listing disabled"); } catch (e) { onError(noticeMessage(e)); } }
  async function recordCurrentNotice() { try { await api(`/jobs/${detail.id}/record-current-privacy-notice`, token, { method: "POST" }); await onUpdate(); onToast("Current privacy notice version linked to this role"); } catch (e) { onError(noticeMessage(e)); } }
  async function assignReviewer(userId: string) { try { await api(`/jobs/${detail.id}/reviewers`, token, { method: "POST", body: json({ user_id: userId }) }); setAssignedReviewers(await api<any[]>(`/jobs/${detail.id}/reviewers`, token)); onToast("Reviewer assigned to this role"); } catch (e) { onError(noticeMessage(e)); } }
  async function inviteReviewer(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!reviewerEmail.trim() || invitingReviewer) return; setInvitingReviewer(true); try { const result = await api<{ email: string; invite_sent?: boolean; invite_url?: string }>(`/jobs/${detail.id}/reviewers/invite`, token, { method: "POST", body: json({ email: reviewerEmail }) }); const [assigned, workspaceMembers] = await Promise.all([api<any[]>(`/jobs/${detail.id}/reviewers`, token), api<any[]>(`/organizations/${org.id}/members`, token)]); setAssignedReviewers(assigned); setAvailableReviewers(workspaceMembers.filter(person => person.role === "reviewer")); setReviewerInviteUrl(result.invite_url || ""); setReviewerEmail(""); onToast(result.invite_url ? "Invite link created. Copy it to share with the reviewer." : result.invite_sent === false ? `Demo mode: no email was sent to ${result.email}` : `Reviewer access is ready for ${result.email}`); } catch (e) { onError(noticeMessage(e)); } finally { setInvitingReviewer(false); } }
  async function copyReviewerInvite() { try { await navigator.clipboard.writeText(reviewerInviteUrl); onToast("Reviewer invitation link copied"); } catch { onError("The link could not be copied. Select and copy it manually."); } }
  async function removeReviewer(userId: string) { try { await api(`/jobs/${detail.id}/reviewers/${userId}`, token, { method: "DELETE" }); setAssignedReviewers(old => old.filter(item => item.user_id !== userId)); onToast("Reviewer access removed"); } catch (e) { onError(noticeMessage(e)); } }
  async function saveInterviewQuestions() {
    const questions = interviewQuestionText.split("\n").map(item => item.trim()).filter(Boolean);
    try { const saved = await api<{ questions: string[] }>(`/jobs/${detail.id}/interview-questions`, token, { method: "PUT", body: json({ questions }) }); setInterviewQuestionText(saved.questions.join("\n")); onToast("Interview questions saved for this role"); }
    catch (e) { onError(noticeMessage(e)); }
  }
  async function addDefaultRubric() {
    if (!rubricConfirmed) { onError("Confirm that you have reviewed the job description before adding the rubric."); return; }
    if (weightTotal !== 100) { onError("Requirement weights must total 100 before they can be saved."); return; }
    const presets = ["Job-related technical or functional skills", "Relevant responsibilities and project evidence", "Relevance and scope of work experience", "Explicitly required domain knowledge", "Explicitly required qualification or certification"];
    try {
      for (let i = 0; i < presets.length; i++) await api(`/jobs/${detail.id}/requirements`, token, { method: "POST", body: json({ org_id: org.id, criterion: presets[i], description: "Edit this criterion to match the confirmed job description.", required: i < 3, weight: weights[i], aliases: [] }) });
      await onUpdate(); setRubricConfirmed(false); onToast("Rubric saved. Edit criterion wording and weights if needed.");
    } catch (e) { onError(noticeMessage(e)); }
  }
  async function updateRequirement(req: Requirement, field: "criterion" | "weight", value: string | number) { try { await api(`/jobs/${detail.id}/requirements/${req.id}`, token, { method: "PATCH", body: json({ [field]: value }) }); await onUpdate(); } catch (e) { onError(noticeMessage(e)); } }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadResult(null); setUploading(true);
    const form = new FormData(); Array.from(files).forEach(file => form.append("files", file)); form.append("consent_status", noticeStatus);
    try { const result = await api<any>(`/jobs/${detail.id}/resumes`, token, { method: "POST", body: form }); setUploadResult(result); await onUpdate(); }
    catch (e) { setUploadResult({ results: [{ filename: "Batch", status: "failed", error: noticeMessage(e) }] }); }
    finally { setUploading(false); }
  }
  async function addNote(app: Application, body: string) { try { await api(`/applications/${app.id}/notes`, token, { method: "POST", body: json({ body }) }); onToast("Note added"); } catch (e) { onError(noticeMessage(e)); } }
  async function bulkScoreVisible() {
    if (!visibleApplications.length || bulkScoring) return;
    setBulkScoring(true);
    try {
      const result = await api<{ total: number; succeeded: number; failed: number; results: { status: string; error?: string }[] }>(`/jobs/${detail.id}/bulk-score`, token, { method: "POST", body: json({ application_ids: visibleApplications.map(item => item.id) }) });
      await onUpdate();
      onToast(`Evidence scores created for ${result.succeeded} of ${result.total} applications`);
      if (result.failed) onError(`${result.failed} application${result.failed === 1 ? "" : "s"} could not be scored. ${result.results.find(item => item.status === "failed")?.error || "Keep them in manual review."}`);
    } catch (e) { onError(noticeMessage(e)); }
    finally { setBulkScoring(false); }
  }
  async function assignCandidate(app: Application, userId: string) { try { await api(`/applications/${app.id}/assign`, token, { method: "PATCH", body: json({ assigned_to: userId }) }); onToast("Candidate assigned to recruiter"); await onUpdate(); } catch (e) { onError(noticeMessage(e)); } }
  const clientName = clients.find(c => c.id === detail.client_id)?.name || "No client linked";
  return <>
    <button className="back-button" onClick={onBack}><ArrowLeft size={16} /> All jobs</button>
    <div className="job-detail-heading"><div><div className="eyebrow">JOB DETAIL · {clientName.toUpperCase()}</div><h1>{detail.title}</h1><p>{detail.location || "Location not set"} · {detail.work_arrangement || "Work arrangement not set"} · Added {dateLabel(detail.created_at)}</p></div>{canManageJob && <div className="job-detail-actions"><select className="input status-select" aria-label="Job status" value={detail.status} onChange={e => saveStatus(e.target.value)}><option value="draft">Draft</option><option value="open">Open</option><option value="paused">Paused</option><option value="filled">Filled</option><option value="archived">Archived</option></select><button className="button button-secondary" onClick={parseJd}><Sparkles size={15} /> Review JD</button></div>}</div>
    {(org.role === "owner" || org.role === "admin" || org.role === "recruitment_manager") && <section className="panel public-listing-control"><div><div className="eyebrow">PUBLIC CAREERS PAGE</div><strong>{detail.public_listing_enabled ? "This role is listed publicly" : "This role is private"}</strong><span>{detail.public_listing_enabled && detail.public_slug ? `Public link: /jobs/${detail.public_slug}` : "Only open roles can be published. Review the job description and privacy notice first."}</span></div><button className={`button ${detail.public_listing_enabled ? "button-secondary" : "button-primary"}`} onClick={() => togglePublicListing(!detail.public_listing_enabled)} disabled={detail.status !== "open" && !detail.public_listing_enabled}>{detail.public_listing_enabled ? "Unpublish role" : "Publish role"}</button></section>}
    {parsedJd && <div className="notice notice-info jd-suggestions"><div><strong>JD extraction suggestions</strong><span>These fields come from supplied text only. Review before confirming; no scoring occurs from unconfirmed suggestions.</span></div><button className="icon-button" onClick={() => setParsedJd(null)} aria-label="Close suggestions"><X size={16} /></button><div className="suggestion-list">{parsedJd.responsibilities?.slice(0, 5).map((item: string, i: number) => <span key={i}>{item}</span>)}</div></div>}
    <div className="job-detail-grid"><section className="panel jd-panel"><div className="panel-header"><div><div className="eyebrow">ROLE BRIEF</div><h2>Job description</h2></div><FileText size={18} className="subtle-icon" /></div><div className="jd-copy">{detail.description ? detail.description : <span className="muted">No job description has been supplied.</span>}</div><div className="jd-meta"><span><Building2 size={15} /> {clientName}</span><span><BriefcaseBusiness size={15} /> {(detail.employment_type || "Employment type not set").replaceAll("_", " ")}</span></div></section>
      {canManageJob && <section className="panel rubric-panel"><div className="panel-header"><div><div className="eyebrow">MATCHING CONFIGURATION</div><h2>Evidence rubric</h2></div><span className="version-tag">v{detail.scoring_version || 1}</span></div><p className="panel-intro">A job-related checklist with editable weights. Weights must total 100. Missing CV evidence stays unknown.</p>
        {detail.requirements?.length ? <div className="requirement-list">{detail.requirements.map(req => <div className="requirement-row" key={req.id}><input className="requirement-name" aria-label="Requirement" defaultValue={req.criterion} onBlur={e => e.target.value !== req.criterion && updateRequirement(req, "criterion", e.target.value)} /><label className="weight-input"><input type="number" min="0" max="100" defaultValue={req.weight} aria-label={`${req.criterion} weight`} onBlur={e => Number(e.target.value) !== req.weight && updateRequirement(req, "weight", Number(e.target.value))} /><span>pts</span></label></div>)}<div className="weight-total"><span>Active weights</span><strong>{detail.requirements.reduce((n, r) => n + r.weight, 0)} / 100</strong></div></div> : <div className="rubric-empty"><div className="empty-icon"><Sparkles size={19} /></div><strong>Confirm criteria before scoring</strong><p>Start from the suggested 40/25/20/10/5 rubric, then edit the criteria to reflect this job.</p><div className="weight-preview">{["Skills", "Responsibilities", "Experience", "Domain", "Qualifications"].map((label, i) => <label key={label}><span>{label}</span><span className="weight-input"><input type="number" value={weights[i]} onChange={e => setWeights(old => old.map((x, ix) => ix === i ? Number(e.target.value) : x))} /><span>pts</span></span></label>)}</div><div className="weight-total"><span>Suggested weights</span><strong className={weightTotal === 100 ? "" : "text-danger"}>{weightTotal} / 100</strong></div><label className="confirm-rubric"><input type="checkbox" checked={rubricConfirmed} onChange={e => setRubricConfirmed(e.target.checked)} /><span>I reviewed the job description and will review/edit each criterion for this role.</span></label><button className="button button-primary button-small" disabled={!rubricConfirmed || weightTotal !== 100} onClick={addDefaultRubric}>Confirm and add rubric</button></div>}
       </section>}</div>
     {canManageJob && <section className="panel reviewer-panel"><div className="panel-header"><div><div className="eyebrow">HUMAN INTERVIEW REVIEW</div><h2>Interview questions</h2></div><FileText size={17} className="subtle-icon" /></div><p className="panel-intro">Questions are specific to this job and remain separate from the CV match rubric. Use one question per line; keep every question role-related.</p><textarea className="textarea" rows={4} value={interviewQuestionText} onChange={e => setInterviewQuestionText(e.target.value)} aria-label="Job interview questions" /><div className="modal-actions"><button className="button button-secondary" onClick={saveInterviewQuestions}>Save questions</button></div></section>}
    {canAssignReviewers && <section className="panel reviewer-panel"><div className="panel-header"><div><div className="eyebrow">SCOPED REVIEW ACCESS</div><h2>Assigned reviewers</h2></div><ShieldCheck size={17} className="subtle-icon" /></div><p className="panel-intro">Reviewers can read evidence for this role and submit interview scorecards. They cannot export or manage workspace data.</p><div className="reviewer-controls"><form className="reviewer-invite-form" onSubmit={inviteReviewer}><label>Invite a client reviewer by email<input className="input" type="email" required maxLength={254} value={reviewerEmail} onChange={event => setReviewerEmail(event.target.value)} placeholder="reviewer@client.example" /></label><button className="button button-secondary button-small" disabled={invitingReviewer}>{invitingReviewer ? "Creating…" : "Create invite link"}</button></form>{reviewerInviteUrl && <div className="invite-link-row"><input className="input" readOnly value={reviewerInviteUrl} aria-label="Reviewer invitation link" /><button className="button button-secondary" type="button" onClick={copyReviewerInvite}>Copy link</button></div>}<select className="input" defaultValue="" onChange={e => { if (e.target.value) assignReviewer(e.target.value); e.target.value = ""; }}><option value="">Assign a workspace reviewer…</option>{availableReviewers.filter(person => !assignedReviewers.some(item => item.user_id === person.user_id)).map(person => <option key={person.user_id} value={person.user_id}>{person.name || person.email || `Reviewer ${person.user_id.slice(0, 8)}`}</option>)}</select><div className="reviewer-list">{assignedReviewers.map(person => <div className="reviewer-chip" key={person.id}><span>{person.email || `Reviewer ${person.user_id.slice(0, 8)}`}</span><button className="icon-button" aria-label="Remove reviewer" onClick={() => removeReviewer(person.user_id)}><X size={14} /></button></div>)}{!assignedReviewers.length && <span className="muted">No reviewers assigned.</span>}</div></div></section>}
    <section className="panel upload-panel"><div className="upload-head"><div><div className="eyebrow">CANDIDATE INTAKE</div><h2>Upload resumes</h2><p>PDF, DOCX, or UTF-8 TXT · up to 10 MB per file · one file may fail without stopping the batch.</p></div><label className={`button button-primary ${uploading ? "is-disabled" : ""}`}><Plus size={16} />{uploading ? "Uploading…" : "Choose resumes"}<input className="file-input" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" multiple disabled={uploading} onChange={e => upload(e.target.files)} /></label></div>
      <div className="upload-privacy"><ShieldCheck size={16} /><span>Files are stored in private workspace storage. Uploading does not imply candidate consent; record notice status only after your agency captures it.</span><label className="notice-select"><span>Notice status</span><select value={noticeStatus} onChange={e => setNoticeStatus(e.target.value)}><option value="not_recorded">Not recorded</option><option value="recorded">Recorded</option><option value="not_required">Not required</option></select></label></div>
      <details className="privacy-notice-preview"><summary>Preview the active candidate privacy notice</summary><p>{privacyNoticeText || "No privacy notice text is set for this workspace."}</p><span>Role notice version: {detail.privacy_notice_version || "not linked"}</span>{canManageJob && <button type="button" className="text-button" onClick={recordCurrentNotice}>Link the current workspace notice to this job</button>}</details>
      {uploadResult && <div className="upload-results">{uploadResult.results?.map((item: any, i: number) => <div className={`upload-result ${item.status === "failed" ? "upload-failed" : ""}`} key={`${item.filename}-${i}`}><div className="file-result-icon">{item.status === "failed" ? <AlertTriangle size={16} /> : <Check size={16} />}</div><div><strong>{item.filename}</strong><span>{item.error || item.warnings?.join(" ") || (item.duplicate_warning ? `Possible duplicate (${item.duplicate_signals?.join(", ")}); review before merging.` : item.status.replaceAll("_", " "))}</span></div></div>)}</div>}
    </section>
    <section className="panel applications-panel"><div className="panel-header"><div><div className="eyebrow">ROLE WORKFLOW</div><h2>Applications <span className="count-chip">{applications.length}</span></h2></div><div className="application-filters">{canManageJob && <button className="button button-secondary button-small" disabled={bulkScoring || !visibleApplications.length || !((detail.requirements || []).length > 0 && (detail.requirements || []).reduce((sum, req) => sum + req.weight, 0) === 100)} onClick={bulkScoreVisible} title="Score the applications in the current view against this job's confirmed criteria">{bulkScoring ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}{bulkScoring ? "Scoring…" : `Score ${visibleApplications.length} shown`}</button>}<div className="select-wrap"><Filter size={14} /><select aria-label="Filter by pipeline stage" value={applicationStage} onChange={e => setApplicationStage(e.target.value)}><option value="all">All candidates</option>{stages.map(stage => <option key={stage}>{stage}</option>)}</select><ChevronDown size={13} /></div><div className="select-wrap"><select aria-label="Sort applications" value={applicationSort} onChange={e => setApplicationSort(e.target.value)}><option value="created_at">Most recent</option><option value="score">Match score</option><option value="coverage">Evidence coverage</option></select><ChevronDown size={13} /></div></div></div>
      {applications.length ? visibleApplications.length ? <div className="application-list">{visibleApplications.map(app => <ApplicationRow key={app.id} app={app} token={token} canManageHiring={canManageJob} assignableUsers={members.filter(member => member.role === "recruiter")} canAssignCandidate={org.role === "sourcer"} onAssign={userId => assignCandidate(app, userId)} requirementsReady={(detail.requirements || []).length > 0 && (detail.requirements || []).reduce((s, r) => s + r.weight, 0) === 100} onStage={stage => onStage(app, stage)} onScore={() => onScore(app)} onScorecard={() => onScorecard(app)} onNote={body => addNote(app, body)} onEvidence={setSelectedEvidence} />)}</div> : <EmptyState icon={<Filter size={20} />} title="No applications in this stage" body="Change the stage filter to see other candidates." /> : <EmptyState icon={<Users size={20} />} title="No applications for this role yet" body="Upload one or more resumes above. Each successful file will create or reuse a candidate record and link it to this job." />}
    </section>
    {selectedEvidence && <EvidenceDrawer detail={selectedEvidence} onClose={() => setSelectedEvidence(null)} />}
  </>;
}

function ApplicationRow({ app, token, canManageHiring, assignableUsers, canAssignCandidate, onAssign, requirementsReady, onStage, onScore, onScorecard, onNote, onEvidence }: { app: Application; token: string; canManageHiring: boolean; assignableUsers: any[]; canAssignCandidate: boolean; onAssign: (userId: string) => void; requirementsReady: boolean; onStage: (s: string) => void; onScore: () => void; onScorecard: () => void; onNote: (s: string) => Promise<void>; onEvidence: (value: any) => void }) {
  const [latest, setLatest] = useState<any>(app.latest_score || null);
  const [note, setNote] = useState("");
  useEffect(() => { setLatest(app.latest_score || null); if (!app.latest_score) api<any[]>(`/applications/${app.id}/score-runs`, token).then(rows => setLatest(rows[0] || null)).catch(() => {}); }, [app.id, token, app.latest_score]);
  async function submitNote() { if (!note.trim()) return; await onNote(note.trim()); setNote(""); }
  if (!canManageHiring) return <article className="application-row"><div className="candidate-main"><div className="avatar avatar-candidate">{initials(app.candidates?.full_name)}</div><div><strong>{app.candidates?.full_name || "Name not extracted"}</strong><span>{app.candidates?.current_title || "Recent title not available"}</span><div className="candidate-tags">{(app.candidates as any)?.skills?.slice(0, 3).map((skill: string) => <span key={skill}>{skill}</span>)}</div></div></div><div className="sourcer-row-controls"><span className="status-pill status-open">{app.stage}</span>{canAssignCandidate && <label>Recruiter<select className="input" aria-label={`Assign ${app.candidates?.full_name || "candidate"} to recruiter`} value={app.owner_id || ""} onChange={e => e.target.value && onAssign(e.target.value)}><option value="">Assign recruiter…</option>{assignableUsers.map(user => <option key={user.user_id} value={user.user_id}>Recruiter {user.user_id.slice(0, 8)}</option>)}</select></label>}</div><div className="note-control"><input className="input" placeholder="Add a sourcing note…" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitNote(); }} /><button className="icon-button" aria-label="Save note" disabled={!note.trim()} onClick={submitNote}><ArrowRight size={16} /></button></div></article>;
  return <article className="application-row"><div className="candidate-main"><div className="avatar avatar-candidate">{initials(app.candidates?.full_name)}</div><div><strong>{app.candidates?.full_name || "Name not extracted"}</strong><span>{app.candidates?.current_title || "Recent title not available"}</span><div className="candidate-tags">{(app.candidates as any)?.skills?.slice(0, 3).map((skill: string) => <span key={skill}>{skill}</span>)}</div></div></div><div className="application-score">{latest?.total_score == null ? <><strong className="score-empty">—</strong><span>Insufficient evidence</span></> : <><strong>{latest.total_score}<small>/100</small></strong><span>{latest.evidence_coverage}% evidence</span></>}</div><div className="application-controls"><select aria-label="Application stage" value={app.stage} onChange={e => onStage(e.target.value)}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select><button className="button button-secondary button-small" onClick={onScore} disabled={!requirementsReady} title={!requirementsReady ? "Confirm a rubric with weights totaling 100 first" : "Create a new evidence score run"}><Sparkles size={14} /> Score</button><button className="button button-ghost button-small" onClick={onScorecard}><FileText size={14} /> Scorecard</button>{latest && <button className="text-button evidence-link" onClick={() => onEvidence({ application: app, result: latest.result, history: latest })}>Evidence</button>}</div><div className="note-control"><input className="input" placeholder="Add a recruiter note…" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitNote(); }} /><button className="icon-button" aria-label="Save note" disabled={!note.trim()} onClick={submitNote}><ArrowRight size={16} /></button></div></article>;
}

function EvidenceDrawer({ detail, onClose }: { detail: any; onClose: () => void }) {
  const result = detail.result || detail.history?.result;
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer evidence-drawer" onClick={e => e.stopPropagation()}><div className="drawer-head"><div><div className="eyebrow">EXPLAINABLE MATCH REVIEW</div><h2>{detail.application?.candidates?.full_name || "Candidate evidence"}</h2></div><button className="icon-button" aria-label="Close evidence" onClick={onClose}><X size={18} /></button></div><div className="score-summary"><div><span>Advisory match score</span><strong>{result?.match_score == null ? "Insufficient evidence" : `${result.match_score}/100`}</strong></div><div><span>Evidence coverage</span><strong>{result?.evidence_coverage ?? detail.history?.evidence_coverage ?? 0}%</strong></div><div><span>Review priority</span><strong>{result?.review_priority?.replaceAll("_", " ") || "Review"}</strong></div></div><div className="notice notice-warning"><AlertTriangle size={16} /><span>This summarizes cited CV evidence only. Unknown information is not treated as proof of missing ability. A recruiter must review and make every decision.</span></div><div className="score-version">Scoring algorithm {result?.scoring_version || detail.history?.algorithm_version} · Rubric v{result?.rubric_version || detail.history?.rubric_version} · {detail.history?.created_at ? dateLabel(detail.history.created_at) : "Latest run"}</div><div className="evidence-criteria">{(result?.criteria || []).map((item: any, i: number) => <article className="evidence-item" key={item.requirement_id || i}><div className="evidence-item-head"><div><strong>{item.criterion}</strong><span>{item.weight} points · {item.rating == null ? "Unrated" : `${item.rating}/5`}</span></div><span className={`evidence-state state-${item.state}`}>{item.state?.replaceAll("_", " ")}</span></div><p>{item.explanation}</p>{item.evidence_quote ? <blockquote>“{item.evidence_quote}”<span>Resume text · page not available</span></blockquote> : <div className="missing-evidence"><CircleHelp size={15} />Not evidenced in CV</div>}{item.review_warning && <div className="review-flag"><AlertTriangle size={14} />Recruiter verification recommended</div>}</article>)}</div></aside></div>;
}

const posterTemplates = [
  ["corporate", "Corporate hiring"], ["manufacturing", "Manufacturing"], ["warehouse", "Warehouse"],
  ["logistics", "Delivery & logistics"], ["retail", "Retail & sales"], ["technology", "IT & engineering"],
  ["fresher", "Fresher hiring"], ["walkin", "Walk-in interview"], ["urgent", "Urgent hiring"],
  ["hospitality", "Hospitality"], ["healthcare", "Healthcare"], ["skilled-trades", "Skilled workers"],
] as const;
const posterFormats = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920], linkedin: [1200, 627], whatsapp: [1080, 1350], a4: [1200, 1697] } as const;
type PosterFormat = keyof typeof posterFormats;
type PosterCopy = Record<string, string>;

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean); let line = ""; let lines = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { ctx.fillText(line, x, y); y += lineHeight; lines++; line = word; if (lines >= maxLines) return y; }
    else line = next;
  }
  if (line && lines < maxLines) { ctx.fillText(line, x, y); y += lineHeight; }
  return y;
}

function drawRecruitPoster(canvas: HTMLCanvasElement, copy: PosterCopy, template: string, format: PosterFormat, color: string, generatedImage?: HTMLImageElement | null) {
  const [width, height] = posterFormats[format]; canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) return;
  const dark = !["corporate", "technology", "fresher", "healthcare"].includes(template);
  const background = dark ? "#102138" : "#f8fafc"; const ink = dark ? "#ffffff" : "#14283f"; const muted = dark ? "#d1deea" : "#52667d";
  context.fillStyle = background; context.fillRect(0, 0, width, height);
  if (generatedImage?.complete && generatedImage.naturalWidth) {
    const heroHeight = height * 0.46; const scale = Math.max(width / generatedImage.width, heroHeight / generatedImage.height);
    const imageWidth = generatedImage.width * scale; const imageHeight = generatedImage.height * scale;
    context.save(); context.beginPath(); context.rect(0, 0, width, heroHeight); context.clip();
    context.drawImage(generatedImage, (width - imageWidth) / 2, (heroHeight - imageHeight) / 2, imageWidth, imageHeight);
    context.fillStyle = dark ? "rgba(12, 30, 47, .52)" : "rgba(247, 250, 251, .84)"; context.fillRect(0, 0, width, heroHeight); context.restore();
  }
  context.fillStyle = color; context.fillRect(0, 0, width, Math.max(22, width * 0.018));
  if (template === "manufacturing" || template === "warehouse" || template === "skilled-trades") {
    context.globalAlpha = 0.14; context.fillStyle = color;
    for (let x = width * 0.7; x < width * 1.2; x += width * 0.09) context.fillRect(x, height * 0.18, width * 0.025, height * 0.6);
    context.globalAlpha = 1;
  }
  const margin = width * 0.075; const maxWidth = width - margin * 2;
  context.textBaseline = "alphabetic"; context.fillStyle = ink;
  context.font = `700 ${Math.round(width * 0.032)}px Arial, sans-serif`; context.fillText("MoSahay", margin, height * 0.085);
  context.fillStyle = color; context.font = `700 ${Math.round(width * 0.018)}px Arial, sans-serif`; context.fillText("PUTTING PEOPLE TO PRODUCTIVE WORK", margin, height * 0.105);
  const hiringY = height * 0.205;
  context.fillStyle = muted; context.font = `700 ${Math.round(width * 0.025)}px Arial, sans-serif`;
  context.fillText(template === "urgent" ? "URGENT HIRING" : template === "walkin" ? "WALK-IN INTERVIEWS" : "WE ARE HIRING", margin, hiringY);
  context.fillStyle = ink; context.font = `700 ${Math.round(width * 0.072)}px Arial, sans-serif`;
  let y = wrapCanvasText(context, copy.title || "Job title", margin, height * 0.29, maxWidth, width * 0.085, 3);
  context.fillStyle = color; context.fillRect(margin, y + width * 0.018, width * 0.16, width * 0.012); y += width * 0.09;
  context.fillStyle = muted; context.font = `600 ${Math.round(width * 0.029)}px Arial, sans-serif`;
  const place = [copy.location, copy.employment_type].filter(Boolean).join("  ·  ");
  if (place) y = wrapCanvasText(context, place, margin, y, maxWidth, width * 0.04, 2) + width * 0.03;
  if (copy.summary) { context.fillStyle = ink; context.font = `400 ${Math.round(width * 0.025)}px Arial, sans-serif`; y = wrapCanvasText(context, copy.summary, margin, y, maxWidth, width * 0.038, 4) + width * 0.035; }
  const facts = [copy.experience && `Experience: ${copy.experience}`, copy.compensation && `Salary: ${copy.compensation}`, copy.vacancies && `Openings: ${copy.vacancies}`, copy.deadline && `Apply by: ${copy.deadline}`].filter(Boolean);
  if (facts.length) {
    context.fillStyle = dark ? "#193653" : "#eaf0f6"; context.fillRect(margin, y, maxWidth, Math.max(width * 0.15, facts.length * width * 0.044 + width * 0.05));
    context.fillStyle = ink; context.font = `600 ${Math.round(width * 0.022)}px Arial, sans-serif`;
    let fy = y + width * 0.045; for (const fact of facts) { context.fillText(fact, margin + width * 0.025, fy); fy += width * 0.042; }
    y += Math.max(width * 0.19, facts.length * width * 0.044 + width * 0.09);
  }
  if (copy.skills) {
    context.fillStyle = muted; context.font = `700 ${Math.round(width * 0.022)}px Arial, sans-serif`; context.fillText("KEY REQUIREMENTS", margin, y); y += width * 0.035;
    context.fillStyle = ink; context.font = `400 ${Math.round(width * 0.022)}px Arial, sans-serif`; y = wrapCanvasText(context, copy.skills, margin, y, maxWidth, width * 0.035, 3);
  }
  context.fillStyle = color; const ctaY = Math.min(height * 0.86, Math.max(y + width * 0.06, height * 0.73));
  context.fillRect(margin, ctaY, maxWidth, height * 0.075); context.fillStyle = "#ffffff"; context.textAlign = "center";
  context.font = `700 ${Math.round(width * 0.026)}px Arial, sans-serif`; context.fillText(copy.cta || "APPLY FOR THIS ROLE", width / 2, ctaY + height * 0.048); context.textAlign = "left";
  if (copy.company) { context.fillStyle = muted; context.font = `600 ${Math.round(width * 0.018)}px Arial, sans-serif`; context.fillText(`Hiring for ${copy.company}`, margin, ctaY + height * 0.11); }
  if (copy.apply_url) { context.fillStyle = muted; context.font = `400 ${Math.round(width * 0.015)}px Arial, sans-serif`; context.fillText(copy.apply_url.slice(0, 90), margin, height * 0.96); }
}

function PosterStudio({ org, jobs, clients, token, onToast, onError }: { org: Workspace; jobs: Job[]; clients: Client[]; token: string; onToast: (s: string) => void; onError: (s: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [jobId, setJobId] = useState(jobs[0]?.id || "");
  const [template, setTemplate] = useState("corporate");
  const [format, setFormat] = useState<PosterFormat>("portrait");
  const [language, setLanguage] = useState("en");
  const [color, setColor] = useState("#1677a8");
  const [copy, setCopy] = useState<PosterCopy>({ title: "", location: "", employment_type: "", summary: "", experience: "", compensation: "", vacancies: "", deadline: "", skills: "", company: "", cta: "APPLY FOR THIS ROLE", apply_url: "", whatsapp: "", linkedin: "", instagram: "" });
  const [history, setHistory] = useState<PosterRecord[]>([]);
  const [activePoster, setActivePoster] = useState<PosterRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [generatedImage, setGeneratedImage] = useState("");
  const selectedJob = jobs.find(item => item.id === jobId);
  const selectedClient = clients.find(item => item.id === selectedJob?.client_id);

  useEffect(() => { if (!jobId && jobs[0]) setJobId(jobs[0].id); }, [jobId, jobs]);
  useEffect(() => {
    if (!selectedJob) return;
    let cancelled = false;
    const money = selectedJob.salary_min != null || selectedJob.salary_max != null
      ? `${selectedJob.salary_currency || "INR"} ${selectedJob.salary_min ?? "—"}–${selectedJob.salary_max ?? "—"}` : "";
    api<Requirement[]>(`/jobs/${selectedJob.id}/requirements`, token).then(requirements => {
      if (cancelled) return;
      setCopy({ title: selectedJob.title, location: selectedJob.location || "", employment_type: (selectedJob.employment_type || "").replaceAll("_", " "), summary: selectedJob.description?.trim().slice(0, 260) || "", experience: selectedJob.experience_min != null || selectedJob.experience_max != null ? `${selectedJob.experience_min ?? "—"}–${selectedJob.experience_max ?? "—"} years` : "", compensation: money, vacancies: selectedJob.vacancies ? String(selectedJob.vacancies) : "", deadline: selectedJob.application_deadline || "", skills: requirements.map(item => item.criterion).slice(0, 8).join(" · "), company: "", cta: "APPLY FOR THIS ROLE", apply_url: "", whatsapp: `Hiring: ${selectedJob.title}${selectedJob.location ? ` in ${selectedJob.location}` : ""}. Contact MoSahay for details.`, linkedin: `MoSahay is sourcing for ${selectedJob.title}${selectedJob.location ? ` in ${selectedJob.location}` : ""}. Apply with the details in the original job listing.`, instagram: `We're hiring: ${selectedJob.title}${selectedJob.location ? ` · ${selectedJob.location}` : ""}.` });
    }).catch(e => { if (!cancelled) onError(noticeMessage(e)); });
    api<PosterRecord[]>(`/jobs/${selectedJob.id}/posters`, token).then(result => { if (!cancelled) setHistory(result); }).catch(e => { if (!cancelled) onError(noticeMessage(e)); });
    setActivePoster(null);
    return () => { cancelled = true; };
  }, [selectedJob, token, onError]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    if (!generatedImage) { drawRecruitPoster(canvas, copy, template, format, color); return; }
    const image = new Image(); image.onload = () => drawRecruitPoster(canvas, copy, template, format, color, image); image.src = generatedImage;
    return () => { image.onload = null; };
  }, [copy, template, format, color, language, generatedImage]);

  function edit(field: string, value: string) { setCopy(old => ({ ...old, [field]: value })); setActivePoster(null); }
  async function save(status: "draft" | "approved" = "draft") {
    if (!selectedJob) { onError("Create a job before saving a poster."); return; }
    setSaving(true);
    try {
      const body = { org_id: org.id, title: copy.title || selectedJob.title, template_id: template, format, language, poster_copy: copy, style: { accent: color, ...(generatedImage ? { generated_image: generatedImage } : {}) }, status };
      const saved = activePoster
        ? await api<PosterRecord>(`/posters/${activePoster.id}`, token, { method: "PATCH", body: json({ ...body, org_id: undefined }) })
        : await api<PosterRecord>(`/jobs/${selectedJob.id}/posters`, token, { method: "POST", body: json(body) });
      setActivePoster(saved); setHistory(old => [saved, ...old.filter(item => item.id !== saved.id)]); onToast(status === "approved" ? "Poster approved for recruiter use" : "Poster draft saved");
    } catch (e) { onError(noticeMessage(e)); }
    finally { setSaving(false); }
  }
  function restore(item: PosterRecord) { setActivePoster(item); setTemplate(item.template_id); setFormat(item.format as PosterFormat); setLanguage(item.language); setCopy(item.poster_copy); setColor(String(item.style?.accent || "#1677a8")); setGeneratedImage(typeof item.style?.generated_image === "string" ? item.style.generated_image : ""); }
  async function generateCopy() {
    if (!selectedJob || aiBusy) return;
    setAiBusy(true);
    try { const result = await api<{ copy: Partial<PosterCopy> }>("/ai/poster-copy", token, { method: "POST", body: json({ job_id: selectedJob.id, template, format, copy: { ...copy, language } }) }); const generated: PosterCopy = {}; Object.entries(result.copy).forEach(([field, value]) => { if (typeof value === "string") generated[field] = value; }); setCopy(old => ({ ...old, ...generated })); setActivePoster(null); onToast("AI poster copy is ready for your review"); }
    catch (e) { onError(noticeMessage(e)); }
    finally { setAiBusy(false); }
  }
  async function generateImage() {
    if (!selectedJob || imageBusy) return;
    setImageBusy(true);
    try { const result = await api<{ image: string }>("/ai/poster-image", token, { method: "POST", body: json({ job_id: selectedJob.id, template, format, copy: { ...copy, language, accent: color } }) }); setGeneratedImage(result.image); setActivePoster(null); onToast("Poster artwork generated. Review it before saving or export."); }
    catch (e) { onError(noticeMessage(e)); }
    finally { setImageBusy(false); }
  }
  function exportPng() {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.toBlob(blob => { if (!blob) { onError("The poster could not be exported as PNG."); return; } const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `mosahay-${(copy.title || "job-poster").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format}.png`; a.click(); URL.revokeObjectURL(url); }, "image/png");
  }
  function exportPdf() {
    const canvas = canvasRef.current; if (!canvas) return;
    const popup = window.open("", "_blank");
    if (!popup) { onError("Allow pop-ups to print the poster to PDF."); return; }
    const image = canvas.toDataURL("image/png");
    popup.document.write(`<!doctype html><title>MoSahay job poster</title><style>@page{margin:0}html,body{margin:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:contain}</style><img src="${image}" alt="${(copy.title || "Job poster").replace(/[<>&\"']/g, "")}"><script>window.onload=()=>{window.print()}<\/script>`);
    popup.document.close();
  }

  return <><PageHeader eyebrow="JOB POSTER STUDIO" title="Create a hiring poster" description="Build editable job advertisements from saved requirements. Every displayed job fact remains editable and recruiter controlled." actions={<><button className="button button-secondary" onClick={() => save("draft")} disabled={saving || !selectedJob}><Save size={15} /> Save draft</button><button className="button button-primary" onClick={() => save("approved")} disabled={saving || !selectedJob}>Approve poster</button></>} />
    {!jobs.length ? <section className="panel"><EmptyState icon={<BriefcaseBusiness size={20} />} title="Create a requirement first" body="The poster studio uses saved role details so missing salary, location, or experience information is not guessed." /></section> : <>
      <div className="poster-workspace"><section className="panel poster-controls"><div className="field-block"><label className="field-label">Source requirement</label><select className="input" value={jobId} onChange={e => setJobId(e.target.value)}>{jobs.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><span className="field-hint">Client: {selectedClient?.name || "Not set"}</span></div>
        <div className="form-two"><div><label className="field-label">Template</label><select className="input" value={template} onChange={e => setTemplate(e.target.value)}>{posterTemplates.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><div><label className="field-label">Format</label><select className="input" value={format} onChange={e => setFormat(e.target.value as PosterFormat)}>{Object.entries(posterFormats).map(([id, size]) => <option key={id} value={id}>{id} · {size[0]} × {size[1]}</option>)}</select></div><div><label className="field-label">Copy language</label><select className="input" value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="hi">Hindi</option><option value="or">Odia</option></select></div><div><label className="field-label">Accent colour</label><input className="input color-input" type="color" value={color} onChange={e => setColor(e.target.value)} /></div></div>
        <div className="poster-copy-fields"><label><span>Job title</span><input className="input" value={copy.title} onChange={e => edit("title", e.target.value)} /></label><label><span>Location</span><input className="input" value={copy.location} onChange={e => edit("location", e.target.value)} placeholder="Leave blank if not supplied" /></label><label><span>Short summary</span><textarea className="textarea" rows={3} value={copy.summary} onChange={e => edit("summary", e.target.value)} /></label><div className="form-two"><label><span>Experience</span><input className="input" value={copy.experience} onChange={e => edit("experience", e.target.value)} /></label><label><span>Salary / compensation</span><input className="input" value={copy.compensation} onChange={e => edit("compensation", e.target.value)} /></label><label><span>Number of vacancies</span><input className="input" value={copy.vacancies} onChange={e => edit("vacancies", e.target.value)} /></label><label><span>Application deadline</span><input className="input" value={copy.deadline} onChange={e => edit("deadline", e.target.value)} /></label></div><label><span>Skills / requirements</span><textarea className="textarea" rows={2} value={copy.skills} onChange={e => edit("skills", e.target.value)} /></label><label><span>Client name to display (optional)</span><input className="input" value={copy.company} onChange={e => edit("company", e.target.value)} placeholder="Only add if the client approved sharing" /></label><label><span>Application URL</span><input className="input" value={copy.apply_url} onChange={e => edit("apply_url", e.target.value)} placeholder="Paste an approved public application link" /></label><label><span>Call to action</span><input className="input" value={copy.cta} onChange={e => edit("cta", e.target.value)} /></label></div>
        <div className="poster-ai-actions"><button className="button button-secondary" type="button" onClick={generateCopy} disabled={aiBusy || !selectedJob}>{aiBusy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{aiBusy ? "Writing copy…" : "Generate copy with AI"}</button><button className="button button-secondary" type="button" onClick={generateImage} disabled={imageBusy || !selectedJob}>{imageBusy ? <LoaderCircle className="spin" size={15} /> : <ImageIcon size={15} />}{imageBusy ? "Creating artwork…" : generatedImage ? "Regenerate artwork" : "Create AI artwork"}</button>{generatedImage && <button className="text-button" type="button" onClick={() => { setGeneratedImage(""); setActivePoster(null); }}>Remove artwork</button>}</div>
        <div className="notice notice-info poster-copy-notice">AI copy and artwork use approved role details only. Review every result; generated content is not published automatically. OpenAI API access must be configured on the backend.</div>
        </section><section className="poster-preview-column"><div className="panel poster-preview-panel"><div className="panel-header"><div><div className="eyebrow">LIVE PREVIEW · {format.toUpperCase()}</div><h2>{copy.title || "Untitled poster"}</h2></div><div className="poster-export-actions"><button className="icon-button" aria-label="Download PNG" title="Download PNG" onClick={exportPng}><Download size={17} /></button><button className="icon-button" aria-label="Print or save PDF" title="Print or save PDF" onClick={exportPdf}><Printer size={17} /></button></div></div><div className="poster-canvas-wrap"><canvas ref={canvasRef} className="poster-canvas" aria-label="Poster preview" /></div><div className="poster-state-row"><span className={`status-pill ${activePoster?.status === "approved" ? "status-open" : "status-draft"}`}>{activePoster?.status || "unsaved draft"}</span><span>{activePoster ? `Saved ${dateLabel(activePoster.created_at)}` : "Not saved"}</span></div></div>
        <div className="poster-social-grid"><label><span>WhatsApp message</span><textarea className="textarea" rows={3} value={copy.whatsapp} onChange={e => edit("whatsapp", e.target.value)} /></label><label><span>LinkedIn caption</span><textarea className="textarea" rows={3} value={copy.linkedin} onChange={e => edit("linkedin", e.target.value)} /></label><label><span>Instagram caption</span><textarea className="textarea" rows={3} value={copy.instagram} onChange={e => edit("instagram", e.target.value)} /></label></div>
      </section></div><section className="panel poster-history"><div className="panel-header"><div><div className="eyebrow">SAVED DESIGNS</div><h2>Poster history</h2></div><span className="count-chip">{history.length}</span></div>{history.length ? <div className="poster-history-list">{history.map(item => <button key={item.id} className={`poster-history-item ${activePoster?.id === item.id ? "selected" : ""}`} onClick={() => restore(item)}><span className="poster-history-icon"><ImageIcon size={17} /></span><span><strong>{item.title}</strong><small>{posterTemplates.find(([id]) => id === item.template_id)?.[1] || item.template_id} · {item.format} · {item.language.toUpperCase()}</small></span><em>{item.status}</em></button>)}</div> : <EmptyState icon={<ImageIcon size={20} />} title="No saved posters yet" body="Save a draft to keep its editable copy, style, and export settings in this job's history." />}</section>
    </>}
  </>;
}

function ScorecardModal({ app, token, onClose, onSaved, onError }: { app: Application; token: string; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [ratings, setRatings] = useState([3, 3, 3]);
  const [notes, setNotes] = useState(["", "", ""]);
  const [blinded, setBlinded] = useState(true);
  const [questions, setQuestions] = useState(["Role-related problem solving", "Evidence of relevant collaboration", "Communication about role-specific work"]);
  useEffect(() => {
    if (!app.job_id) return;
    api<{ questions: string[] }>(`/jobs/${app.job_id}/interview-questions`, token)
      .then(result => { setQuestions(result.questions); setRatings(result.questions.map(() => 3)); setNotes(result.questions.map(() => "")); })
      .catch(e => onError(noticeMessage(e)));
  }, [app.job_id, token, onError]);
  async function submit() { try { await api(`/applications/${app.id}/scorecards`, token, { method: "POST", body: json({ blinded, answers: questions.map((question, i) => ({ question, rating: ratings[i], evidence_notes: notes[i] || "" })) }) }); onSaved(); } catch (e) { onError(noticeMessage(e)); } }
  return <Modal title="Interview scorecard" description={`Human-provided feedback for ${app.candidates?.full_name || "this candidate"}. Kept separate from the CV evidence score.`} onClose={onClose}><div className="scorecard-form">{questions.map((question, i) => <div className="scorecard-question" key={`${question}-${i}`}><span>{question}</span><select className="input" aria-label={`Rating for ${question}`} value={ratings[i] || 3} onChange={e => setRatings(old => old.map((r, ix) => ix === i ? Number(e.target.value) : r))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n} — {n === 1 ? "Limited evidence" : n === 5 ? "Strong evidence" : "Meets expectations"}</option>)}</select><textarea className="textarea" rows={2} aria-label={`Evidence notes for ${question}`} value={notes[i] || ""} onChange={e => setNotes(old => old.map((note, ix) => ix === i ? e.target.value : note))} placeholder="Record role-related examples and evidence…" /></div>)}<label className="confirm-rubric"><input type="checkbox" checked={blinded} onChange={e => setBlinded(e.target.checked)} /><span>Keep other reviewers’ feedback blind until the reviewer submits</span></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={submit}>Submit scorecard</button></div></div></Modal>;
}

function Modal({ title, description, onClose, children, wide = false }: { title: string; description: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) { return <div className="modal-backdrop" onClick={onClose}><section className={`modal ${wide ? "modal-wide" : ""}`} onClick={e => e.stopPropagation()}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" onClick={onClose} aria-label="Close modal"><X size={18} /></button></div>{children}</section></div>; }
