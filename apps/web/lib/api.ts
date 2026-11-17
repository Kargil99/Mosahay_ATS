import { demoApi } from "@/lib/demo-api";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message); this.status = status; this.code = code;
  }
}

export function apiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  const host = typeof window === "undefined" ? "localhost" : window.location.hostname;
  const protocol = typeof window === "undefined" ? "http:" : window.location.protocol;
  return `${protocol}//${host}:8000/api/v1`;
}

export async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  if (token.startsWith("demo:")) return demoApi<T>(path, init);
  const headers = new Headers(init.headers);
  if (token !== "mongo-cookie") headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    try {
      const data = await response.json();
      message = data?.detail?.error?.message || data?.detail?.message || data?.message || message;
      code = data?.detail?.error?.code;
    } catch { /* Keep the generic status message. */ }
    throw new ApiError(message, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  return (contentType.includes("application/json") ? response.json() : response.text()) as Promise<T>;
}

export function json(body: unknown): string { return JSON.stringify(body); }
