"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, CheckCircle2, Clock3, MapPin, Search, ShieldCheck, UploadCloud } from "lucide-react";
import { apiBase } from "@/lib/api";

type PublicJob = {
  id: string; slug: string; title: string; description: string; location?: string | null;
  work_arrangement?: string | null; employment_type?: string | null; salary_min?: number | null;
  salary_max?: number | null; salary_currency?: string | null; experience_min?: number | null;
  experience_max?: number | null; vacancies?: number | null; application_deadline?: string | null;
  department?: string | null; industry?: string | null; organization_name: string;
  privacy_notice_text?: string; privacy_notice_version?: string;
};

async function publicApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    let message = "We could not complete that request. Please try again.";
    try { const data = await response.json(); message = data?.detail?.error?.message || data?.message || message; } catch { /* Use a safe generic error. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function money(job: PublicJob) {
  if (job.salary_min == null && job.salary_max == null) return "Compensation shared during the process";
  const currency = job.salary_currency || "INR";
  return `${currency} ${job.salary_min?.toLocaleString("en-IN") ?? "—"}–${job.salary_max?.toLocaleString("en-IN") ?? "—"}`;
}

export function CareersPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [industry, setIndustry] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [experienceMin, setExperienceMin] = useState("");
  const [experienceMax, setExperienceMax] = useState("");
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const params = useMemo(() => {
    const values: Record<string, string> = { search: query, location, industry, employment_type: employmentType, salary_min: salaryMin, salary_max: salaryMax, experience_min: experienceMin, experience_max: experienceMax };
    const searchParams = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value) searchParams.set(key, value); }); return searchParams.toString();
  }, [query, location, industry, employmentType, salaryMin, salaryMax, experienceMin, experienceMax]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError("");
    const timer = setTimeout(() => publicApi<PublicJob[]>(`/public/jobs?${params}`)
      .then((data) => { if (!cancelled) setJobs(data); })
      .catch((err: Error) => { if (!cancelled) { setJobs([]); setError(err.message); } })
      .finally(() => { if (!cancelled) setBusy(false); }), 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [params]);
  return <main className="career-page">
    <header className="career-nav"><Link href="/careers" className="career-brand"><span className="career-mark">M</span><span>MoSahay <b>Careers</b></span></Link><div><Link href="/candidate-portal">Candidate portal</Link><Link href="/hire-talent">Hire talent</Link></div></header>
    <section className="career-hero"><div className="career-hero-inner"><div className="career-eyebrow">FIND YOUR NEXT OPPORTUNITY</div><h1>Work that moves<br /><em>you forward.</em></h1><p>Explore open roles and apply directly with MoSahay.</p>
      <form className="career-search" onSubmit={(event) => event.preventDefault()}><label><Search size={18} /><input aria-label="Job title or keyword" placeholder="Job title or keyword" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label><MapPin size={18} /><input aria-label="Location" placeholder="City or location" value={location} onChange={(event) => setLocation(event.target.value)} /></label><button type="submit">Search jobs</button></form>
      <div className="career-filter-row"><input aria-label="Filter by industry" placeholder="Industry" value={industry} onChange={event => setIndustry(event.target.value)} /><select aria-label="Filter by employment type" value={employmentType} onChange={event => setEmploymentType(event.target.value)}><option value="">Any employment type</option><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="temporary">Temporary</option><option value="internship">Internship</option></select><input aria-label="Minimum salary" type="number" min="0" placeholder="Min salary" value={salaryMin} onChange={event => setSalaryMin(event.target.value)} /><input aria-label="Maximum salary" type="number" min="0" placeholder="Max salary" value={salaryMax} onChange={event => setSalaryMax(event.target.value)} /><input aria-label="Minimum experience" type="number" min="0" max="100" step="0.5" placeholder="Min years" value={experienceMin} onChange={event => setExperienceMin(event.target.value)} /><input aria-label="Maximum experience" type="number" min="0" max="100" step="0.5" placeholder="Max years" value={experienceMax} onChange={event => setExperienceMax(event.target.value)} /></div>
    </div><div className="career-orbit career-orbit-one" /><div className="career-orbit career-orbit-two" /></section>
    <section className="career-results"><div className="career-results-head"><div><div className="career-eyebrow">CURRENT OPENINGS</div><h2>Roles that are open now</h2></div><span>{busy ? "Searching…" : `${jobs.length} ${jobs.length === 1 ? "role" : "roles"}`}</span></div>
      {error && <div className="career-message career-error">{error}</div>}
      {!busy && !error && jobs.length === 0 && <div className="career-empty"><BriefcaseBusiness size={25} /><strong>No matching openings right now</strong><span>Try a different title or location, or check back soon.</span></div>}
      <div className="career-job-grid">{jobs.map((job) => <Link className="career-job-card" href={`/jobs/${encodeURIComponent(job.slug)}`} key={job.id}>
        <div className="career-card-top"><span className="career-job-icon"><BriefcaseBusiness size={18} /></span>{job.employment_type && <span className="career-type">{job.employment_type.replaceAll("_", " ")}</span>}</div>
        <h3>{job.title}</h3><p className="career-company">{job.organization_name}{job.department ? ` · ${job.department}` : ""}</p>
        <div className="career-meta"><span><MapPin size={14} />{job.location || "Location discussed"}</span>{job.experience_min != null && <span><Clock3 size={14} />{job.experience_min}–{job.experience_max ?? "Open"} yrs</span>}</div>
        <div className="career-card-foot"><span>{money(job)}</span><span className="career-arrow">View role <ArrowRight size={15} /></span></div>
      </Link>)}</div>
      <p className="career-footnote"><ShieldCheck size={15} />Your application is handled according to the privacy notice shown before you submit.</p>
    </section>
    <footer className="career-footer">MoSahay · Putting People to Productive Work</footer>
  </main>;
}

export function JobDetailPage({ slug }: { slug: string }) {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let alive = true; publicApi<PublicJob>(`/public/jobs/${encodeURIComponent(slug)}`).then((data) => { if (alive) setJob(data); }).catch((err: Error) => { if (alive) setError(err.message); }); return () => { alive = false; }; }, [slug]);
  if (error) return <PublicError message={error} />;
  if (!job) return <main className="career-page"><div className="career-loading">Loading job details…</div></main>;
  return <main className="career-page"><PublicHeader /><section className="career-detail-wrap"><Link href="/careers" className="career-back"><ArrowLeft size={15} />All open roles</Link>
    <article className="career-detail"><div className="career-detail-head"><div><div className="career-eyebrow">{job.organization_name.toUpperCase()}</div><h1>{job.title}</h1><div className="career-meta career-meta-large"><span><MapPin size={16} />{job.location || "Location discussed"}</span>{job.employment_type && <span><BriefcaseBusiness size={16} />{job.employment_type.replaceAll("_", " ")}</span>}{job.work_arrangement && <span>{job.work_arrangement.replaceAll("_", " ")}</span>}</div></div><Link className="career-apply-button" href={`/apply/${encodeURIComponent(job.slug)}`}>Apply for this role <ArrowRight size={17} /></Link></div>
      <div className="career-detail-facts"><div><span>Compensation</span><strong>{money(job)}</strong></div>{job.experience_min != null && <div><span>Experience</span><strong>{job.experience_min}–{job.experience_max ?? "Open"} years</strong></div>}{job.vacancies != null && <div><span>Open positions</span><strong>{job.vacancies}</strong></div>}{job.application_deadline && <div><span>Apply by</span><strong>{new Date(`${job.application_deadline}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong></div>}</div>
      <section className="career-description"><h2>About the role</h2><p>{job.description || "Role details will be discussed during the application process."}</p></section>
      <section className="career-privacy"><ShieldCheck size={18} /><div><strong>How we use your information</strong><p>{job.privacy_notice_text || "Your application information will be used to review your application and may be shared with the recruiting client. Contact MoSahay for access, correction, export, or deletion requests."}</p><small>Notice version: {job.privacy_notice_version || "current"}</small></div></section>
      <Link className="career-apply-button career-apply-bottom" href={`/apply/${encodeURIComponent(job.slug)}`}>Apply for this role <ArrowRight size={17} /></Link>
    </article></section><PublicFooter /></main>;
}

export function ApplyPage({ slug }: { slug: string }) {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ application_id: string; duplicate_email: boolean; duplicate_resume: boolean; access_key: string } | null>(null);
  useEffect(() => { let alive = true; publicApi<PublicJob>(`/public/jobs/${encodeURIComponent(slug)}`).then((data) => { if (alive) setJob(data); }).catch((err: Error) => { if (alive) setError(err.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [slug]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await publicApi<{ application_id: string; duplicate_email: boolean; duplicate_resume: boolean; access_key: string }>(`/public/jobs/${encodeURIComponent(slug)}/apply`, { method: "POST", body: form });
      sessionStorage.setItem("mosahay-candidate-access-key", response.access_key);
      setResult(response);
    } catch (err) { setError(err instanceof Error ? err.message : "We could not submit your application."); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="career-page"><div className="career-loading">Loading application form…</div></main>;
  if (!job) return <PublicError message={error || "This job is no longer accepting applications."} />;
  return <main className="career-page"><PublicHeader /><section className="career-apply-wrap"><Link href={`/jobs/${encodeURIComponent(slug)}`} className="career-back"><ArrowLeft size={15} />Back to job details</Link>
    <div className="career-apply-card"><div className="career-eyebrow">APPLICATION</div><h1>{result ? "Application received" : `Apply for ${job.title}`}</h1><p className="career-apply-subtitle">{job.organization_name} · {job.location || "Location discussed"}</p>
      {result ? <div className="career-success"><CheckCircle2 size={34} /><strong>Thank you for applying.</strong><span>Your application reference is {result.application_id.slice(0, 8).toUpperCase()}.</span>{(result.duplicate_email || result.duplicate_resume) && <span>We found a possible duplicate profile or resume. The team will review it before linking anything.</span>}<div className="career-access-key"><strong>Save your candidate access key</strong><code>{result.access_key}</code><small>This key is shown once. Keep it private. You can use it to review application status, update basic details, withdraw consent, or make a privacy request.</small><button type="button" className="career-key-copy" onClick={() => navigator.clipboard.writeText(result.access_key)}>Copy key</button></div><Link href="/candidate-portal" className="career-apply-button">Open candidate portal <ArrowRight size={16} /></Link><Link href="/careers" className="career-secondary-link">Browse more roles</Link></div> : <form className="career-form" onSubmit={submit}>
        <div className="career-form-grid"><input type="hidden" name="privacy_notice_version" value={job.privacy_notice_version || ""} /><label>Full name<input name="full_name" required minLength={2} maxLength={180} autoComplete="name" /></label><label>Email address<input name="email" required type="email" maxLength={254} autoComplete="email" /></label><label>Mobile number<input name="phone" required type="tel" minLength={7} maxLength={40} autoComplete="tel" /></label><label>Current city<input name="city" maxLength={120} autoComplete="address-level2" /></label><label>Preferred location<input name="preferred_location" maxLength={120} /></label><label>Total experience (years)<input name="experience_years" type="number" min="0" max="80" step="0.1" /></label><label className="career-wide">Skills, separated by commas<input name="skills" maxLength={3000} placeholder="For example: machine operation, inventory, customer service" /></label><label>Availability<input name="availability" maxLength={120} placeholder="For example: immediate, 30 days" /></label>
          <label className="career-file career-wide"><UploadCloud size={19} /><span>Resume <small>PDF, DOCX, or TXT · up to 10 MB</small></span><input type="file" name="resume" required accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" /></label></div>
        <details className="career-notice"><summary>Read privacy notice</summary><p>{job.privacy_notice_text || "Your CV and contact information are used to review your application and may be shared with the recruiting client. Contact the agency for access, correction, export, or deletion."}</p><small>Notice version: {job.privacy_notice_version || "current"}</small></details>
        <label className="career-consent"><input type="checkbox" name="consent" value="true" required /><span>I have read the privacy notice and consent to MoSahay using my application information to assess me for this role and, where relevant, sharing it with the recruiting client.</span></label>
        {error && <div className="career-message career-error">{error}</div>}<button className="career-apply-button career-submit" disabled={busy}>{busy ? "Submitting securely…" : "Submit application"}<ArrowRight size={17} /></button><p className="career-smallprint"><ShieldCheck size={14} />Your resume is stored in private workspace storage.</p>
      </form>}
    </div></section><PublicFooter /></main>;
}

type CandidatePortalRecord = {
  candidate: { full_name: string; email: string; phone: string; skills: string[]; consent_status: string; privacy_notice_version: string; city: string; preferred_location: string; availability: string; experience_years?: number };
  application: { job_title: string; location: string; stage: string; status: string; submitted_at: string };
  privacy_notice_text: string;
};

export function CandidatePortalPage() {
  const [accessKey, setAccessKey] = useState("");
  const [record, setRecord] = useState<CandidatePortalRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [requestType, setRequestType] = useState("access");
  const [requestDetails, setRequestDetails] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [preferredLocation, setPreferredLocation] = useState("");
  const [availability, setAvailability] = useState("");
  const [skills, setSkills] = useState("");
  const loadPortal = useCallback(async (key = accessKey) => {
    setBusy(true); setMessage("");
    try {
      const data = await publicApi<CandidatePortalRecord>("/public/candidate-portal", { headers: { "X-Candidate-Access-Key": key } });
      setRecord(data); setAccessKey(key); sessionStorage.setItem("mosahay-candidate-access-key", key);
      setPhone(data.candidate.phone || ""); setCity(data.candidate.city || ""); setPreferredLocation(data.candidate.preferred_location || ""); setAvailability(data.candidate.availability || ""); setSkills((data.candidate.skills || []).join(", "));
    } catch (err) { setRecord(null); setMessage(err instanceof Error ? err.message : "Candidate portal access failed."); }
    finally { setBusy(false); }
  }, [accessKey]);
  useEffect(() => { const saved = sessionStorage.getItem("mosahay-candidate-access-key") || ""; if (saved) { setAccessKey(saved); void loadPortal(saved); } }, [loadPortal]);
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await publicApi("/public/candidate-portal/profile", { method: "PATCH", headers: { "X-Candidate-Access-Key": accessKey }, body: JSON.stringify({ phone, city, preferred_location: preferredLocation, availability, skills: skills.split(",").map(value => value.trim()).filter(Boolean).slice(0, 30) }) });
      setMessage("Your profile details were updated."); await loadPortal(accessKey);
    } catch (err) { setMessage(err instanceof Error ? err.message : "Profile update failed."); setBusy(false); }
  }
  async function withdrawConsent() {
    if (!window.confirm("Withdraw consent for this application? The recruitment team will be notified and your active application will be marked withdrawn.")) return;
    setBusy(true); setMessage("");
    try { await publicApi("/public/candidate-portal/withdraw-consent", { method: "POST", headers: { "X-Candidate-Access-Key": accessKey } }); setMessage("Consent withdrawn. The recruitment team has been notified."); await loadPortal(accessKey); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Consent withdrawal failed."); setBusy(false); }
  }
  async function submitPrivacyRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await publicApi("/public/candidate-portal/privacy-requests", { method: "POST", headers: { "X-Candidate-Access-Key": accessKey }, body: JSON.stringify({ request_type: requestType, details: requestDetails }) }); setRequestDetails(""); setMessage("Your privacy request has been recorded for review."); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Privacy request failed."); }
    finally { setBusy(false); }
  }
  return <main className="career-page"><PublicHeader /><section className="career-portal-wrap"><div className="career-eyebrow">CANDIDATE SELF SERVICE</div><h1>Your MoSahay application</h1><p className="career-portal-intro">Enter your private access key to view status and manage basic profile and privacy settings.</p>
    {!record ? <form className="career-portal-key" onSubmit={event => { event.preventDefault(); void loadPortal(); }}><label>Candidate access key<input value={accessKey} onChange={event => setAccessKey(event.target.value)} autoComplete="off" required /></label><button className="career-apply-button" disabled={busy}>{busy ? "Checking…" : "Open my portal"}</button>{message && <div className="career-message career-error">{message}</div>}<small>Your key is private. MoSahay stores only a one way hash and cannot retrieve the original key.</small></form> : <>
      <section className="career-portal-application"><div><span>APPLICATION STATUS</span><strong>{record.application.stage}</strong><small>{record.application.status === "withdrawn" ? "Consent withdrawn" : `Submitted ${new Date(record.application.submitted_at).toLocaleDateString("en-IN")}`}</small></div><div><span>ROLE</span><strong>{record.application.job_title}</strong><small>{record.application.location || "Location discussed"}</small></div></section>
      <section className="career-portal-card"><h2>Contact and preferences</h2><form className="career-portal-form" onSubmit={saveProfile}><label>Mobile number<input value={phone} onChange={event => setPhone(event.target.value)} required minLength={7} maxLength={40} /></label><label>Current city<input value={city} onChange={event => setCity(event.target.value)} maxLength={120} /></label><label>Preferred location<input value={preferredLocation} onChange={event => setPreferredLocation(event.target.value)} maxLength={120} /></label><label>Availability<input value={availability} onChange={event => setAvailability(event.target.value)} maxLength={120} /></label><label className="career-portal-wide">Skills, separated by commas<input value={skills} onChange={event => setSkills(event.target.value)} /></label><button className="career-apply-button" disabled={busy}>Save profile</button></form></section>
      <section className="career-portal-card"><h2>Privacy and consent</h2><details className="career-notice"><summary>Current privacy notice · {record.candidate.privacy_notice_version}</summary><p>{record.privacy_notice_text}</p></details><p className="career-portal-status">Consent status: <strong>{record.candidate.consent_status.replaceAll("_", " ")}</strong></p><button className="career-withdraw" onClick={withdrawConsent} disabled={busy || record.candidate.consent_status === "withdrawn"}>Withdraw consent and withdraw active applications</button>
        <form className="career-request-form" onSubmit={submitPrivacyRequest}><h3>Submit a privacy request</h3><select value={requestType} onChange={event => setRequestType(event.target.value)}><option value="access">Access my data</option><option value="correction">Correct my information</option><option value="export">Export my data</option><option value="deletion">Request deletion</option><option value="consent_withdrawal">Consent withdrawal follow-up</option></select><textarea value={requestDetails} onChange={event => setRequestDetails(event.target.value)} minLength={3} maxLength={5000} placeholder="Tell us what you need help with" required /><button className="button button-secondary" disabled={busy}>Send request</button></form>
      </section>{message && <div className="career-message career-notice-message">{message}</div>}<button className="career-key-reset" onClick={() => { sessionStorage.removeItem("mosahay-candidate-access-key"); setRecord(null); setAccessKey(""); }}>Sign out of candidate portal</button>
    </>}
  </section><PublicFooter /></main>;
}

function PublicHeader() { return <header className="career-nav"><Link href="/careers" className="career-brand"><span className="career-mark">M</span><span>MoSahay <b>Careers</b></span></Link><div><Link href="/careers">Open roles</Link><Link href="/candidate-portal">Candidate portal</Link><Link href="/hire-talent">Hire talent</Link></div></header>; }
function PublicFooter() { return <footer className="career-footer">MoSahay · Putting People to Productive Work</footer>; }
function PublicError({ message }: { message: string }) { return <main className="career-page"><PublicHeader /><section className="career-error-page"><div className="career-empty"><BriefcaseBusiness size={25} /><strong>Role unavailable</strong><span>{message}</span><Link href="/careers" className="career-apply-button">Browse open roles</Link></div></section><PublicFooter /></main>; }

export function HireTalentPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leadId, setLeadId] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const minSalary = String(form.get("salary_min") || ""); const maxSalary = String(form.get("salary_max") || "");
    if (minSalary && maxSalary && Number(maxSalary) < Number(minSalary)) { setError("Maximum salary must be at least the minimum salary."); setBusy(false); return; }
    const values = Object.fromEntries(form.entries());
    const body = { ...values, vacancies: Number(values.vacancies), required_skills: String(values.required_skills || "").split(",").map(value => value.trim()).filter(Boolean).slice(0, 50), salary_min: minSalary ? Number(minSalary) : null, salary_max: maxSalary ? Number(maxSalary) : null };
    try { const result = await publicApi<{ id: string }>("/public/hire-talent", { method: "POST", body: JSON.stringify(body) }); setLeadId(result.id); }
    catch (err) { setError(err instanceof Error ? err.message : "We could not send your inquiry."); }
    finally { setBusy(false); }
  }
  return <main className="career-page"><PublicHeader /><section className="career-hire-wrap"><div className="career-hire-intro"><span className="career-hire-icon"><Building2 size={21} /></span><div className="career-eyebrow">FOR EMPLOYERS</div><h1>Tell us who you’re looking to hire.</h1><p>Share a few details about your hiring need. Our team will review your inquiry and follow up using the contact details you provide.</p></div>
    {leadId ? <div className="career-hire-success"><CheckCircle2 size={35} /><h2>Inquiry received</h2><p>Reference: {leadId.slice(0, 8).toUpperCase()}. A MoSahay team member will follow up after reviewing your request.</p><Link href="/careers" className="career-apply-button">Explore candidate opportunities <ArrowRight size={16} /></Link></div> : <form className="career-hire-form" onSubmit={submit}>
      <div className="career-hire-grid"><label>Company name<input name="company_name" required minLength={2} maxLength={180} /></label><label>Company website <span>Optional</span><input name="website" type="url" maxLength={300} placeholder="https://" /></label><label>Contact person<input name="contact_name" required minLength={2} maxLength={180} /></label><label>Business email<input name="email" type="email" required maxLength={254} /></label><label>Phone / WhatsApp<input name="phone" type="tel" required minLength={7} maxLength={40} /></label><label>Job title<input name="job_title" required minLength={2} maxLength={180} /></label><label>Number of vacancies<input name="vacancies" required type="number" min="1" max="10000" defaultValue="1" /></label><label>Hiring timeline<input name="hiring_timeline" required maxLength={180} placeholder="For example: within 30 days" /></label><label>Work location<input name="location" required minLength={1} maxLength={180} /></label><label>Experience required<input name="experience" maxLength={180} placeholder="For example: 2–4 years" /></label><label>Minimum salary (INR)<input name="salary_min" type="number" min="0" step="1000" /></label><label>Maximum salary (INR)<input name="salary_max" type="number" min="0" step="1000" /></label><label className="career-hire-wide">Required skills<input name="required_skills" maxLength={5000} placeholder="List skills separated by commas" /></label></div>
      <p className="career-hire-privacy"><ShieldCheck size={15} />Your contact details will be used to respond to this hiring inquiry.</p>{error && <div className="career-message career-error">{error}</div>}<button className="career-apply-button career-submit" disabled={busy}>{busy ? "Sending inquiry…" : "Send hiring inquiry"}<ArrowRight size={17} /></button>
    </form>}
  </section><PublicFooter /></main>;
}
