"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Copy, ExternalLink, LoaderCircle, Search, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api, json } from "@/lib/api";

type JobOption = { id: string; title: string; description: string; location?: string; industry?: string; department?: string };
type Query = { label: string; intent: string; query: string };
type CriterionEvidence = { criterion: string; weight: number; rating: number | null; state: string; explanation: string; evidence_quote?: string | null; confidence: string };
type ScoreResult = { match_score: number | null; evidence_coverage: number; confidence: string; review_priority: string; criteria: CriterionEvidence[]; notice: string };
type SourcedProfile = { id: string; linkedin_url: string; name: string; headline: string; profile_text: string; score_result?: ScoreResult | null; created_at: string; scored_at?: string };

function messageOf(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please retry."; }

export function XRaySourcingPage({ jobs, token }: { jobs: JobOption[]; token: string }) {
  const [jobId, setJobId] = useState("");
  const [queries, setQueries] = useState<Query[]>([]);
  const [profiles, setProfiles] = useState<SourcedProfile[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoringId, setScoringId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!jobId && jobs.length) setJobId(jobs[0].id);
  }, [jobId, jobs]);

  useEffect(() => {
    if (!jobId) { setProfiles([]); setQueries([]); return; }
    let active = true;
    setLoadingProfiles(true); setError("");
    api<SourcedProfile[]>(`/jobs/${jobId}/xray-profiles`, token)
      .then(result => { if (active) setProfiles(result); })
      .catch(issue => { if (active) setError(messageOf(issue)); })
      .finally(() => { if (active) setLoadingProfiles(false); });
    return () => { active = false; };
  }, [jobId, token]);

  const rankedProfiles = useMemo(() => [...profiles].sort((a, b) => {
    const scoreA = a.score_result?.match_score;
    const scoreB = b.score_result?.match_score;
    if (scoreA == null && scoreB == null) return a.name.localeCompare(b.name);
    if (scoreA == null) return 1;
    if (scoreB == null) return -1;
    return scoreB - scoreA || (b.score_result?.evidence_coverage || 0) - (a.score_result?.evidence_coverage || 0);
  }), [profiles]);
  const comparableCount = profiles.filter(profile => profile.profile_text.trim().length >= 30).length;

  async function generateQueries() {
    if (!jobId) return;
    setGenerating(true); setError(""); setNotice("");
    try {
      const result = await api<{ queries: Query[] }>(`/jobs/${jobId}/xray-search`, token);
      setQueries(result.queries);
      setNotice(`Created ${result.queries.length} Google X-ray search strings from the selected job.`);
    } catch (issue) { setError(messageOf(issue)); }
    finally { setGenerating(false); }
  }

  async function copyQuery(query: string) {
    try { await navigator.clipboard.writeText(query); setNotice("Search string copied to clipboard."); }
    catch { setError("Could not copy the search string. Select the text and copy it manually."); }
  }

  async function importProfiles() {
    if (!jobId) return;
    const urls = urlInput.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) { setError("Paste one LinkedIn profile URL per line."); return; }
    setImporting(true); setError(""); setNotice("");
    try {
      const result = await api<{ profiles: SourcedProfile[]; imported: number; invalid_urls: { url: string; reason: string }[] }>(`/jobs/${jobId}/xray-profiles`, token, { method: "POST", body: json({ urls }) });
      setProfiles(result.profiles);
      setUrlInput("");
      setNotice(`${result.imported} profile link${result.imported === 1 ? "" : "s"} added. Open each profile and paste the job-related evidence you want to compare.${result.invalid_urls.length ? ` ${result.invalid_urls.length} invalid link${result.invalid_urls.length === 1 ? " was" : "s were"} skipped.` : ""}`);
    } catch (issue) { setError(messageOf(issue)); }
    finally { setImporting(false); }
  }

  function updateProfile(id: string, changes: Partial<SourcedProfile>) {
    setProfiles(current => current.map(profile => profile.id === id ? { ...profile, ...changes } : profile));
  }

  async function compareProfile(profile: SourcedProfile) {
    if (profile.profile_text.trim().length < 30) { setError("Paste at least 30 characters of job-related profile evidence before comparing."); return; }
    setScoringId(profile.id); setError(""); setNotice("");
    try {
      const result = await api<SourcedProfile>(`/jobs/${jobId}/xray-profiles/${profile.id}/compare`, token, {
        method: "POST", body: json({ name: profile.name, headline: profile.headline, profile_text: profile.profile_text }),
      });
      updateProfile(profile.id, result);
      setNotice(`Evidence score saved for ${result.name || "the LinkedIn profile"}.`);
    } catch (issue) { setError(messageOf(issue)); }
    finally { setScoringId(""); }
  }

  async function compareAll() {
    const pending = profiles.filter(profile => profile.profile_text.trim().length >= 30);
    if (!pending.length) { setError("Paste profile evidence for at least one LinkedIn profile first."); return; }
    setScoring(true); setError(""); setNotice("");
    const results = await Promise.allSettled(pending.map(profile => api<SourcedProfile>(`/jobs/${jobId}/xray-profiles/${profile.id}/compare`, token, {
      method: "POST", body: json({ name: profile.name, headline: profile.headline, profile_text: profile.profile_text }),
    })));
    let passed = 0;
    results.forEach(result => {
      if (result.status === "fulfilled") { updateProfile(result.value.id, result.value); passed += 1; }
    });
    setScoring(false);
    if (passed) setNotice(`${passed} profile${passed === 1 ? "" : "s"} compared. Rankings use job-related evidence coverage and match scores.`);
    if (passed < pending.length) setError(`${pending.length - passed} profile${pending.length - passed === 1 ? " could" : "s could"} not be scored. Check the active job criteria and try again.`);
  }

  async function removeProfile(profile: SourcedProfile) {
    setError("");
    try {
      await api<void>(`/jobs/${jobId}/xray-profiles/${profile.id}`, token, { method: "DELETE" });
      setProfiles(current => current.filter(item => item.id !== profile.id));
      setNotice("Profile removed from this sourcing list.");
    } catch (issue) { setError(messageOf(issue)); }
  }

  return <div className="xray-page">
    <div className="page-header"><div><div className="eyebrow">TALENT SOURCING</div><h1>Google X-ray search</h1><p>Turn a job description into search strings, collect profile links, and compare job-related evidence.</p></div></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <div className="notice notice-info" role="status">{notice}</div>}
    {!jobs.length ? <section className="panel xray-empty"><Search size={25} /><h2>Create a job to begin</h2><p>X-ray search strings are built from a job’s title, location, and active criteria.</p></section> : <>
      <section className="panel xray-job-picker">
        <label htmlFor="xray-job" className="field-label">Choose a position</label>
        <select id="xray-job" className="input" value={jobId} onChange={event => { setJobId(event.target.value); setQueries([]); setNotice(""); }}>
          {jobs.map(job => <option key={job.id} value={job.id}>{job.title}{job.location ? ` · ${job.location}` : ""}</option>)}
        </select>
        <button className="button button-primary" type="button" onClick={generateQueries} disabled={!jobId || generating}>{generating ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{generating ? "Building searches…" : "Generate search strings"}</button>
      </section>

      <section className="panel xray-search-panel">
        <div className="panel-header"><div><div className="eyebrow">SEARCH ON GOOGLE</div><h2>Search strings from the job description</h2></div><Search size={18} className="subtle-icon" /></div>
        {!queries.length ? <div className="xray-empty-inline">Generate strings to get Google-ready queries using the job title, must-have criteria, aliases, industry, and location.</div> : <div className="xray-query-list">{queries.map((item, index) => <article className="xray-query-card" key={`${item.label}-${index}`}>
          <div className="xray-query-heading"><div><h3>{item.label}</h3><p>{item.intent}</p></div><span className="count-chip">Search {index + 1}</span></div>
          <textarea className="textarea xray-query-text" rows={3} aria-label={`${item.label} search string`} value={item.query} onChange={event => setQueries(current => current.map((query, i) => i === index ? { ...query, query: event.target.value } : query))} />
          <div className="xray-query-actions"><button className="button button-secondary" type="button" onClick={() => copyQuery(item.query)}><Copy size={15} /> Copy string</button><a className="button button-primary" href={`https://www.google.com/search?q=${encodeURIComponent(item.query)}`} target="_blank" rel="noopener noreferrer">Search Google <ArrowUpRight size={15} /></a></div>
        </article>)}</div>}
      </section>

      <section className="panel xray-import-panel">
        <div className="panel-header"><div><div className="eyebrow">SOURCED PROFILES</div><h2>Add LinkedIn profile links</h2></div><span className="count-chip">{profiles.length} saved</span></div>
        <p className="xray-helper">Paste one individual <code>linkedin.com/in/…</code> profile URL per line. RecruitOS saves the link against this job and opens LinkedIn in a new tab for your review.</p>
        <textarea className="textarea" rows={4} placeholder={"https://www.linkedin.com/in/profile-one/\nhttps://www.linkedin.com/in/profile-two/"} value={urlInput} onChange={event => setUrlInput(event.target.value)} />
        <div className="xray-query-actions"><button className="button button-primary" type="button" onClick={importProfiles} disabled={importing || !urlInput.trim()}>{importing ? <LoaderCircle className="spin" size={16} /> : <ExternalLink size={16} />}{importing ? "Adding links…" : "Add profile links"}</button><span className="field-hint">Up to 25 links per paste. Duplicate links for this job are kept once.</span></div>
      </section>

      <section className="xray-results-section">
        <div className="xray-results-heading"><div><div className="eyebrow">PROFILE COMPARISON</div><h2>Evidence-based shortlist</h2><p>Open each profile, then paste relevant work history, skills, and education for a transparent comparison against the job rubric.</p></div><button className="button button-secondary" type="button" onClick={compareAll} disabled={scoring || !comparableCount}>{scoring ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{scoring ? "Comparing profiles…" : `Compare all (${comparableCount})`}</button></div>
        <div className="xray-responsible-note"><ShieldCheck size={18} /><span>Scores use only the profile evidence pasted here and active job criteria. They are advisory, show evidence coverage, and never make a hiring decision. Avoid pasting sensitive or unrelated personal information.</span></div>
        {loadingProfiles ? <div className="loading-inline"><LoaderCircle className="spin" size={17} /> Loading saved profiles…</div> : !rankedProfiles.length ? <section className="panel xray-empty"><Search size={23} /><h3>No profiles added yet</h3><p>Add links from your Google X-ray results to start a comparison.</p></section> : <div className="xray-profile-list">{rankedProfiles.map((profile, index) => {
          const result = profile.score_result;
          return <article className="panel xray-profile-card" key={profile.id}>
            <div className="xray-profile-head"><div className="xray-rank">{result?.match_score == null ? "—" : `#${index + 1}`}</div><div className="xray-profile-identity"><h3>{profile.name || "LinkedIn profile"}</h3><p>{profile.headline || "Paste a headline or role summary after opening the profile."}</p><a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer">Open LinkedIn profile <ExternalLink size={13} /></a></div><div className="xray-profile-score"><strong>{result?.match_score == null ? "—" : `${result.match_score}%`}</strong><span>{result?.match_score == null ? "Not compared" : `${result.evidence_coverage}% evidence coverage`}</span></div><button className="icon-button" type="button" aria-label="Remove profile" title="Remove profile" onClick={() => removeProfile(profile)}><Trash2 size={16} /></button></div>
            <div className="xray-profile-fields"><label className="field-label">Name<input className="input" value={profile.name} maxLength={120} onChange={event => updateProfile(profile.id, { name: event.target.value })} placeholder="Candidate name (optional)" /></label><label className="field-label">Headline<input className="input" value={profile.headline} maxLength={300} onChange={event => updateProfile(profile.id, { headline: event.target.value })} placeholder="Current role or headline (optional)" /></label></div>
            <label className="field-label xray-evidence-label">Paste job-related profile evidence<textarea className="textarea" rows={5} maxLength={12000} value={profile.profile_text} onChange={event => updateProfile(profile.id, { profile_text: event.target.value })} placeholder="After opening LinkedIn, paste relevant role history, skills, and education. Keep it focused on the job criteria. At least 30 characters are needed to compare." /></label>
            <div className="xray-profile-actions"><button className="button button-secondary" type="button" onClick={() => compareProfile(profile)} disabled={scoringId === profile.id || scoring}>{scoringId === profile.id ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{scoringId === profile.id ? "Comparing…" : "Compare profile"}</button>{result && <span className="xray-score-caption">{result.confidence} confidence · recruiter review required</span>}</div>
            {result?.criteria?.length ? <details className="xray-evidence-details"><summary>Review criterion evidence ({result.criteria.length})</summary><div className="xray-criterion-list">{result.criteria.map((item, i) => <div className="xray-criterion" key={`${item.criterion}-${i}`}><div><strong>{item.criterion}</strong><span>{item.weight}% weight · {item.state.replaceAll("_", " ")}</span></div><p>{item.evidence_quote ? `“${item.evidence_quote}”` : item.explanation}</p></div>)}</div><p className="field-hint">{result.notice}</p></details> : null}
          </article>;
        })}</div>}
      </section>
    </>}
  </div>;
}
