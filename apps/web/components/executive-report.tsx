"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, LoaderCircle, Printer, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

type Job = { id: string; title: string; status: string; client_id?: string | null; industry?: string | null; location?: string | null };
type Client = { id: string; name: string };
type Member = { user_id: string; role: string };
type Report = { kpis: Record<string, number>; monthly_performance: { month: string; applications: number; placements: number; expected_fee: number; paid_fee: number }[]; source_performance: Record<string, number>; recruiter_performance: { recruiter_id: string; applications: number; screened: number; placements: number; expected_fee: number }[]; client_performance: { client_id: string; name: string; open_jobs: number; applications: number; placements: number; expected_fee: number }[]; conversion: Record<string, number | null>; time_to_fill: { average_days: number | null; median_days: number | null; completed_hires: number }; tasks: { due_today: number; overdue: number; upcoming_interviews: number; today_items: { id: string; title: string; due_at: string; priority: string }[]; overdue_items: { id: string; title: string; due_at: string; priority: string }[]; upcoming_interview_items: { scheduled_at: string; candidate_name: string; job_title: string }[]; requirements_deadline_soon: { job_id: string; title: string; application_deadline: string }[] }; truncated: boolean };

const labels: Record<string, string> = {
  active_clients: "Active clients", active_requirements: "Open requirements", open_positions: "Open positions",
  candidate_count: "Candidates in database", candidates_screened: "Candidates screened", candidates_submitted: "Submitted to clients",
  interviews_scheduled: "Interviews scheduled", offers_released: "Offers released", candidates_joined: "Candidates joined",
  successful_placements: "Successful placements", expected_placement_revenue: "Expected placement fees",
  collected_placement_revenue: "Fees marked paid", pending_client_payments: "Unpaid placement records", partial_payment_records: "Partially paid records",
};
const currency = (value: number) => `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function ExecutiveReport({ orgId, token, jobs, clients, members }: { orgId: string; token: string; jobs: Job[]; clients: Client[]; members: Member[] }) {
  const [filters, setFilters] = useState({ date_from: "", date_to: "", recruiter_id: "", client_id: "", industry: "", job_id: "", location: "" });
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const options = useMemo(() => ({
    industries: [...new Set(jobs.map(item => item.industry).filter((item): item is string => Boolean(item)))].sort(),
    locations: [...new Set(jobs.map(item => item.location).filter((item): item is string => Boolean(item)))].sort(),
  }), [jobs]);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ org_id: orgId });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    setLoading(true); setError("");
    api<Report>(`/analytics/executive?${params.toString()}`, token)
      .then(value => { if (live) setReport(value); })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : "Management analytics could not be loaded."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filters, orgId, token]);

  function updateFilter(key: keyof typeof filters, value: string) { setFilters(current => ({ ...current, [key]: value })); }
  function exportCsv() {
    if (!report) return;
    const rows: (string | number)[][] = [["Metric", "Value"], ...Object.entries(report.kpis).map(([key, value]) => [labels[key] || key, value])];
    rows.push([], ["Recruiter", "Applications", "Screened", "Placements", "Expected fee"]);
    for (const item of report.recruiter_performance) rows.push([`Recruiter ${item.recruiter_id.slice(0, 8)}`, item.applications, item.screened, item.placements, item.expected_fee]);
    rows.push([], ["Client", "Open roles", "Applications", "Placements", "Expected fee"]);
    for (const item of report.client_performance) rows.push([item.name, item.open_jobs, item.applications, item.placements, item.expected_fee]);
    const csv = rows.map(row => row.map(value => { const text = String(value ?? ""); const safe = text.trimStart().startsWith(("=+-@")) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mosahay-recruitos-management-report.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  const kpis = report?.kpis || {};
  const monthlyMax = Math.max(1, ...(report?.monthly_performance || []).map(item => item.expected_fee));
  const sourceEntries = Object.entries(report?.source_performance || {}).sort((a, b) => b[1] - a[1]);
  return <section className="executive-report">
    <div className="executive-heading"><div><div className="eyebrow">MANAGEMENT ANALYTICS</div><h2>Recruitment and business performance</h2><p>Workspace-scoped totals with filters for date, recruiter, client, industry, role, and location.</p></div><div className="executive-actions"><button className="button button-secondary button-small" onClick={exportCsv} disabled={!report}><ArrowDownToLine size={14} /> Export report</button><button className="button button-ghost button-small" onClick={() => window.print()}><Printer size={14} /> Print / PDF</button></div></div>
    <div className="panel executive-filters"><label>From<input type="date" value={filters.date_from} onChange={event => updateFilter("date_from", event.target.value)} /></label><label>To<input type="date" value={filters.date_to} onChange={event => updateFilter("date_to", event.target.value)} /></label><label>Recruiter<select value={filters.recruiter_id} onChange={event => updateFilter("recruiter_id", event.target.value)}><option value="">All recruiters</option>{members.filter(item => item.role === "recruiter").map(item => <option value={item.user_id} key={item.user_id}>Recruiter {item.user_id.slice(0, 8)}</option>)}</select></label><label>Client<select value={filters.client_id} onChange={event => updateFilter("client_id", event.target.value)}><option value="">All clients</option>{clients.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Industry<select value={filters.industry} onChange={event => updateFilter("industry", event.target.value)}><option value="">All industries</option>{options.industries.map(value => <option key={value}>{value}</option>)}</select></label><label>Role<select value={filters.job_id} onChange={event => updateFilter("job_id", event.target.value)}><option value="">All roles</option>{jobs.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>Location<select value={filters.location} onChange={event => updateFilter("location", event.target.value)}><option value="">All locations</option>{options.locations.map(value => <option key={value}>{value}</option>)}</select></label><button className="text-button exec-reset" onClick={() => setFilters({ date_from: "", date_to: "", recruiter_id: "", client_id: "", industry: "", job_id: "", location: "" })}>Clear filters</button></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}{report?.truncated && <div className="notice notice-info">This report reached the 5,000 row window. Narrow the filters to review a smaller slice.</div>}
    {loading && !report ? <div className="panel executive-loading"><LoaderCircle className="spin" size={18} /> Loading management metrics…</div> : report && <>
      <div className="executive-kpis">{Object.entries(labels).map(([key, label]) => <article className="panel executive-kpi" key={key}><span>{label}</span><strong>{key.includes("revenue") ? currency(kpis[key]) : Number(kpis[key] || 0).toLocaleString()}</strong></article>)}</div>
      <div className="executive-grid"><section className="panel executive-panel"><div className="panel-header"><div><div className="eyebrow">PLACEMENT REVENUE</div><h3>Expected fee trend</h3></div></div><div className="exec-month-bars">{report.monthly_performance.length ? report.monthly_performance.map(item => <div className="exec-month" key={item.month}><div className="exec-month-columns"><span title={`Expected ${currency(item.expected_fee)}`} style={{ height: `${Math.max(3, item.expected_fee / monthlyMax * 100)}%` }} /><i title={`Paid ${currency(item.paid_fee)}`} style={{ height: `${Math.max(3, item.paid_fee / monthlyMax * 100)}%` }} /></div><small>{item.month.slice(2)}</small></div>) : <p className="muted">No monthly records in this filter.</p>}</div><div className="exec-legend"><span><i /> Expected</span><span><i /> Marked paid</span></div><div className="exec-ratios">{[["Submission to interview", report.conversion.submission_to_interview_pct], ["Interview to offer", report.conversion.interview_to_offer_pct], ["Offer to joining", report.conversion.offer_to_joining_pct]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value == null ? "—" : `${value}%`}</strong></div>)}</div></section>
        <section className="panel executive-panel"><div className="panel-header"><div><div className="eyebrow">RECRUITER PERFORMANCE</div><h3>Pipeline ownership</h3></div></div>{report.recruiter_performance.length ? <div className="exec-table-wrap"><table><thead><tr><th>Recruiter</th><th>Applications</th><th>Screened</th><th>Placements</th><th>Expected fee</th></tr></thead><tbody>{report.recruiter_performance.map(item => <tr key={item.recruiter_id}><td>Recruiter {item.recruiter_id.slice(0, 8)}</td><td>{item.applications}</td><td>{item.screened}</td><td>{item.placements}</td><td>{currency(item.expected_fee)}</td></tr>)}</tbody></table></div> : <p className="muted">No recruiter activity in this filter.</p>}<div className="exec-task-summary"><span><b>{report.tasks.due_today}</b> follow-ups due today</span><span><b>{report.tasks.overdue}</b> overdue follow-ups</span><span><b>{report.tasks.upcoming_interviews}</b> upcoming interviews</span></div><div className="exec-action-lists"><div><strong>Overdue follow-ups</strong>{report.tasks.overdue_items.map(item => <span key={item.id}>{item.title} · due {new Date(item.due_at).toLocaleDateString()}</span>)}{!report.tasks.overdue_items.length && <small>None overdue</small>}</div><div><strong>Follow-ups due today</strong>{report.tasks.today_items.map(item => <span key={item.id}>{item.title} · {item.priority}</span>)}{!report.tasks.today_items.length && <small>None due today</small>}</div><div><strong>Upcoming interviews</strong>{report.tasks.upcoming_interview_items.map((item, index) => <span key={`${item.scheduled_at}-${index}`}>{item.candidate_name} · {item.job_title} · {new Date(item.scheduled_at).toLocaleString()}</span>)}{!report.tasks.upcoming_interview_items.length && <small>None scheduled</small>}</div></div><div className="exec-deadline-list">{report.tasks.requirements_deadline_soon.map(item => <span key={item.job_id}>{item.title} · closes {item.application_deadline}</span>)}</div></section>
      </div>
      <div className="executive-grid"><section className="panel executive-panel"><div className="panel-header"><div><div className="eyebrow">CLIENT PERFORMANCE</div><h3>Hiring activity by client</h3></div></div>{report.client_performance.length ? <div className="exec-table-wrap"><table><thead><tr><th>Client</th><th>Open roles</th><th>Applications</th><th>Placements</th><th>Expected fee</th></tr></thead><tbody>{report.client_performance.map(item => <tr key={item.client_id}><td>{item.name}</td><td>{item.open_jobs}</td><td>{item.applications}</td><td>{item.placements}</td><td>{currency(item.expected_fee)}</td></tr>)}</tbody></table></div> : <p className="muted">No client activity in this filter.</p>}</section>
        <section className="panel executive-panel"><div className="panel-header"><div><div className="eyebrow">CANDIDATE SOURCES</div><h3>Candidate sources</h3></div></div>{sourceEntries.length ? sourceEntries.map(([source, count]) => <div className="exec-source" key={source}><span>{source.replaceAll("_", " ")}</span><strong>{count}</strong></div>) : <p className="muted">No source data in this filter.</p>}<div className="exec-time-fill"><span>Average time to fill</span><strong>{report.time_to_fill.average_days == null ? "—" : `${report.time_to_fill.average_days} days`}</strong><small>Median {report.time_to_fill.median_days == null ? "—" : `${report.time_to_fill.median_days} days`}</small></div><p className="exec-data-note"><ShieldCheck size={13} /> Fees marked paid use the placement payment status. The current placement record does not store partial payment amounts, so partial records are counted separately from collected fees.</p></section></div>
      <div className="exec-print-title"><strong>MoSahay RecruitOS management report</strong><span>{new Date().toLocaleDateString()}</span></div>
    </>}
  </section>;
}
