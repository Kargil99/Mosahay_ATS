"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen, DemoAccessScreen } from "@/components/auth-screen";
import { AtsApp } from "@/components/ats-app";
import { LoaderCircle } from "lucide-react";
import { apiBase } from "@/lib/api";

const DEMO_SESSION_KEY = "mosahay_demo_session";
const DEMO_SIGNED_OUT_KEY = "mosahay_demo_signed_out";
function sessionFor(account: { id: string; email: string; name?: string; providers?: string[] }, kind: "demo" | "mongodb"): Session {
  const token = kind === "demo" ? `demo:${account.id}` : "mongo-cookie";
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: kind === "demo" ? 31536000 : 43200,
    expires_at: Math.floor(Date.now() / 1000) + (kind === "demo" ? 31536000 : 43200),
    refresh_token: kind === "demo" ? "demo-local-session" : "http-only-cookie-session",
    user: {
      id: account.id,
      aud: "authenticated",
      role: "authenticated",
      email: account.email,
      app_metadata: { provider: kind, providers: account.providers || [kind] },
      user_metadata: { name: account.name || "RecruitOS teammate" },
      created_at: new Date().toISOString(),
    },
  } as unknown as Session;
}

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mongoEnabled, setMongoEnabled] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [showDemoAuth, setShowDemoAuth] = useState(false);

  useEffect(() => {
    let active = true;
    async function openSession() {
      const query = new URLSearchParams(window.location.search);
      const invite = query.get("invite") || "";
      const authComplete = query.get("auth") === "complete";
      if (active) setInviteToken(invite);
      try {
        const configResponse = await fetch(`${apiBase()}/auth/config`, { cache: "no-store", credentials: "include" });
        const config = configResponse.ok ? await configResponse.json() : {};
        if (active) setMongoEnabled(Boolean(config.mongodb_enabled));
        if (config.mongodb_enabled) {
          const response = await fetch(`${apiBase()}/auth/session`, { cache: "no-store", credentials: "include" });
          const { user } = response.ok ? await response.json() : { user: null };
          if (user && active) {
            if (invite) {
              await fetch(`${apiBase()}/organizations/invitations/accept`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: invite }) });
            }
            setSession(sessionFor(user, "mongodb"));
          }
          if ((invite || authComplete) && active) window.history.replaceState({}, "", window.location.pathname);
        } else {
          try {
            const saved = localStorage.getItem(DEMO_SESSION_KEY);
            if (saved) setSession(sessionFor(JSON.parse(saved), "demo"));
          } catch { /* A local demo session is optional and can be started from the welcome screen. */ }
        }
      } catch { /* If the API is not configured, development can still use the local demo. */ }
      if (active) setReady(true);
    }
    void openSession();
    return () => { active = false; };
  }, []);

  if (!ready) return <main className="loading-screen"><LoaderCircle className="spin" size={24} /><span>Opening your workspace…</span></main>;
  const saveDemoAccount = (account: { id: string; email: string; name?: string }) => {
    localStorage.removeItem(DEMO_SIGNED_OUT_KEY);
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(account));
    setSession(sessionFor(account, "demo"));
  };
  if (!session && (showDemoAuth || (process.env.NODE_ENV !== "production" && !mongoEnabled))) return <DemoAccessScreen onLogin={saveDemoAccount} onBack={mongoEnabled || process.env.NODE_ENV === "production" ? () => setShowDemoAuth(false) : undefined} />;
  if (!session) return <AuthScreen inviteToken={inviteToken} onLogin={account => setSession(sessionFor(account, "mongodb"))} onOpenDemo={!mongoEnabled ? () => setShowDemoAuth(true) : undefined} />;
  return <AtsApp session={session} onSignOut={async () => {
    if (session.access_token === "mongo-cookie") {
      await fetch(`${apiBase()}/auth/logout`, { method: "POST", credentials: "include" });
      setShowDemoAuth(false);
    } else {
      localStorage.removeItem(DEMO_SESSION_KEY); localStorage.setItem(DEMO_SIGNED_OUT_KEY, "1");
    }
    setSession(null);
  }} />;
}
