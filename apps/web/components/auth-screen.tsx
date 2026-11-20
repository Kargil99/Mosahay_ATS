"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { apiBase } from "@/lib/api";

export const DEMO_EMAIL = "demo@mosahay.com";
export const DEMO_PASSWORD = "RecruitOSDemo2026!";

type DemoAccount = { id: string; email: string; name?: string };

async function passwordDigest(password: string) {
  const bytes = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mosahay-demo:${password}`));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function DemoAccessScreen({ onLogin, onBack }: { onLogin: (account: DemoAccount) => void; onBack?: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === "signup") {
        if (name.trim().length < 2) throw new Error("Enter your name (at least 2 characters).");
        if (password.length < 8) throw new Error("Use at least 8 characters for the demo password.");
        const accounts: { id: string; email: string; name: string; password_hash: string }[] = JSON.parse(localStorage.getItem("mosahay_demo_accounts") || "[]");
        if (accounts.some(account => account.email === normalizedEmail)) throw new Error("A demo account with that email already exists.");
        const account = { id: `demo-user-${crypto.randomUUID()}`, email: normalizedEmail, name: name.trim(), password_hash: await passwordDigest(password) };
        localStorage.setItem("mosahay_demo_accounts", JSON.stringify([...accounts, account]));
        onLogin({ id: account.id, email: account.email, name: account.name });
      } else {
        if (!normalizedEmail || !password) throw new Error("Enter your email and password.");
        if (normalizedEmail === DEMO_EMAIL && password === DEMO_PASSWORD) {
          onLogin({ id: "demo-user-owner", email: DEMO_EMAIL, name: "Demo Recruiter" });
        } else {
          const accounts: { id: string; email: string; name: string; password_hash: string }[] = JSON.parse(localStorage.getItem("mosahay_demo_accounts") || "[]");
          const account = accounts.find(item => item.email === normalizedEmail);
          if (!account || account.password_hash !== await passwordDigest(password)) throw new Error("Those demo credentials were not found. Use the sample credentials or create a demo account.");
          onLogin({ id: account.id, email: account.email, name: account.name });
        }
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not open demo workspace."); }
    finally { setBusy(false); }
  }

  return <main className="auth-layout">
    <section className="auth-story"><div className="brand"><span className="brand-mark"><BriefcaseBusiness size={19} /></span><span>MoSahay <b>RecruitOS</b></span></div><div className="story-copy"><div className="eyebrow light"><span className="status-dot" /> LOCAL PRODUCT DEMO</div><h1>Explore the<br />recruitment<br /><em>workspace.</em></h1><p>Sample records are stored only in this browser. Nothing is sent to a server.</p></div><div className="story-footer"><ShieldCheck size={17} /><span>Demo records only. No real candidate data.</span></div><div className="decor decor-one" /><div className="decor decor-two" /></section>
    <section className="auth-panel"><div className="auth-panel-inner"><div className="auth-mobile-brand brand"><span className="brand-mark"><BriefcaseBusiness size={18} /></span><span>MoSahay <b>RecruitOS</b></span></div><div className="auth-heading"><div className="eyebrow">{mode === "signin" ? "DEMO ACCESS" : "LOCAL DEMO SIGN-UP"}</div><h2>{mode === "signin" ? "Open the demo workspace" : "Create a demo profile"}</h2><p>{mode === "signin" ? "Use the sample login or a browser-only account you created." : "This creates a local demo login and opens the shared sample workspace."}</p></div>
      {mode === "signin" && <div className="notice notice-info"><b>Demo credentials</b><span>Email: <code>{DEMO_EMAIL}</code><br />Password: <code>{DEMO_PASSWORD}</code></span></div>}
      <form className="auth-form" onSubmit={submit}>{mode === "signup" && <><label className="field-label" htmlFor="demo-name">Name</label><input id="demo-name" className="input" autoComplete="name" value={name} onChange={event => setName(event.target.value)} required minLength={2} /></>}<label className="field-label" htmlFor="demo-email">Email</label><input id="demo-email" className="input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /><label className="field-label" htmlFor="demo-password">Password</label><input id="demo-password" className="input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={8} />{message && <div className="notice notice-error" role="alert">{message}</div>}<button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? "Opening…" : mode === "signin" ? "Enter demo workspace" : "Create demo account"}<ArrowRight size={16} /></button></form>
      <div className="auth-switch">{mode === "signin" ? "Want a separate demo login?" : "Already created a local demo account?"}<button className="text-button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "Sign up" : "Sign in"}</button></div><p className="auth-legal">Demo sign-up is browser-only. Connect MongoDB to use team accounts.</p>{onBack && <div className="demo-back-row"><button className="text-button" type="button" onClick={onBack}>Back to team sign-in</button></div>}</div></section>
  </main>;
}

export function AuthScreen({ onLogin, onOpenDemo, inviteToken = "" }: { onLogin: (account: DemoAccount) => void; onOpenDemo?: () => void; inviteToken?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">(inviteToken ? "signup" : "signin");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [mongoEnabled, setMongoEnabled] = useState(false);
  const [publicSignupEnabled, setPublicSignupEnabled] = useState(true);

  useEffect(() => {
    fetch(`${apiBase()}/auth/config`, { cache: "no-store", credentials: "include" }).then(response => response.json()).then(config => {
      setGoogleEnabled(Boolean(config.google_enabled)); setMongoEnabled(Boolean(config.mongodb_enabled)); setPublicSignupEnabled(config.signup_enabled !== false);
      if (config.signup_enabled === false && !inviteToken) setMode("signin");
    }).catch(() => undefined);
  }, [inviteToken]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${apiBase()}/auth/${mode === "signin" ? "login" : "register"}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signin" ? { email, password } : { name, email, password, invite_token: inviteToken || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail?.error?.message || "Could not open your workspace. Check your details and retry.");
      onLogin(data.user);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not sign in. Please retry."); }
    finally { setBusy(false); }
  }

  function continueWithGoogle() {
    window.location.assign(`${apiBase()}/auth/google/start`);
  }

  return <main className="auth-layout">
    <section className="auth-story">
      <div className="brand"><span className="brand-mark"><BriefcaseBusiness size={19} /></span><span>MoSahay <b>RecruitOS</b></span></div>
        <div className="story-copy">
        <div className="eyebrow light"><span className="status-dot" /> YOUR TEAM, IN SYNC</div>
        <h1>Great hiring<br />starts with a<br /><em>clearer view.</em></h1>
        <p>Bring clients, roles, candidate evidence, and every next step together in one welcoming workspace.</p>
      </div>
      <div className="story-footer"><ShieldCheck size={17} /><span>Private by workspace. Human led by design.</span></div>
      <div className="decor decor-one" /><div className="decor decor-two" />
    </section>
    <section className="auth-panel">
      <div className="auth-panel-inner">
        <div className="auth-mobile-brand brand"><span className="brand-mark"><BriefcaseBusiness size={18} /></span><span>MoSahay <b>RecruitOS</b></span></div>
        <div className="auth-heading"><div className="eyebrow">WELCOME TO MOSAHAY RECRUITOS</div><h2>{mode === "signin" ? "Welcome back" : "Create your team account"}</h2><p>{mode === "signin" ? "Sign in to your recruitment workspace." : "Use your work email to join your team or start a workspace."}</p></div>
        {!mongoEnabled && <div className="notice notice-warning"><b>Connect your workspace database</b><span>MongoDB must be configured on the API service before team accounts can be created. Local development can use the sample demo sign-in.</span></div>}
        {inviteToken && <div className="notice notice-info"><b>You have a team invitation</b><span>Create an account with the invited email address to join your team workspace.</span></div>}
        <button className="button button-secondary button-full google-auth-button" type="button" onClick={continueWithGoogle} disabled={!mongoEnabled || !googleEnabled} title={!googleEnabled ? "Configure Google OAuth on the API service to enable this option." : undefined}><span className="google-mark">G</span>{googleEnabled ? "Continue with Google" : "Continue with Google · setup required"}</button>
        <div className="auth-link-note">{googleEnabled ? "A verified Google email can link to an account you already have." : "Google sign-in and account linking will work after GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured on the API service."}</div>
        <div className="auth-divider"><span>or use work email</span></div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && <><label className="field-label" htmlFor="name">Full name</label><input id="name" className="input" autoComplete="name" placeholder="Your name" required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} /></>}
          <label className="field-label" htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="email" placeholder="name@company.com" required value={email} onChange={event => setEmail(event.target.value)} />
          <div className="label-row"><label className="field-label" htmlFor="password">Password</label>{mode === "signup" && <span className="field-hint">12 characters minimum</span>}</div>
          <div className="password-wrap"><input id="password" className="input" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder={mode === "signup" ? "At least 12 characters" : "Your password"} required minLength={mode === "signup" ? 12 : 1} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /><button className="icon-button password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          {message && <div className="notice notice-error" role="alert">{message}</div>}
          <button className="button button-primary button-full" type="submit" disabled={!mongoEnabled || busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}<ArrowRight size={16} /></button>
        </form>
        {(publicSignupEnabled || inviteToken || mode === "signup") && <div className="auth-switch">{mode === "signin" ? "New to your team?" : "Already have an account?"}<button className="text-button" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "Create an account" : "Sign in"}</button></div>}
        {onOpenDemo && <div className="demo-preview-link"><button className="text-button" type="button" onClick={onOpenDemo}>Explore the sample browser demo</button><span>Local-only sample records; changes don’t sync with your team.</span></div>}
        <p className="auth-legal">RecruitOS keeps your team’s hiring work in a private workspace. Candidate fit scores are review aids; hiring decisions remain human-led.</p>
      </div>
    </section>
  </main>;
}
