"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const FOREST_GREEN = "#2E7040";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setLoading(false);
        if (res.status === 429 && typeof payload?.retry_after_seconds === "number") {
          setError(`Too many login attempts. Please try again in ${payload.retry_after_seconds} seconds.`);
          return;
        }
        setError(typeof payload?.error === "string" ? payload.error : "Login failed");
        return;
      }
    } catch (e) {
      setLoading(false);
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg === "Failed to fetch" ? "Could not reach the login service." : msg);
      return;
    }
    // Full page redirect so the server receives the session cookies on the next request.
    // Using router.push() can run the dashboard layout before cookies are sent, causing redirect back to login.
    setLoading(false);
    window.location.href = "/roster";
  }

  return (
    <div className="min-h-screen bg-[#0F1311] px-4 py-10 text-[#ECE7DF] sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/10 bg-[#121614] shadow-[0_24px_70px_rgba(0,0,0,0.45)] md:grid-cols-[1.1fr_1fr]">
          <div className="hidden border-r border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(46,112,64,0.35),transparent_55%),#151917] p-10 md:flex md:flex-col md:justify-between">
            <div>
              <p className="app-title text-xs uppercase tracking-[0.2em] text-[#AFA89C]">TeamIntel</p>
              <h1 className="mt-5 text-3xl font-semibold leading-tight text-[#F4F1EB]">
                Athlete intelligence,
                <br />
                sponsorship actions.
              </h1>
              <p className="mt-4 max-w-sm text-sm text-[#B9B2A6]">
                Sign in to access roster insights, CRM workflows, contracts, and the Mystery Machine assistant.
              </p>
            </div>
            <p className="text-xs text-[#8E877A]">Internal access only.</p>
          </div>

          <div className="p-7 sm:p-10">
            <div className="mb-8">
              <p className="app-title text-xs uppercase tracking-[0.2em] text-[#AFA89C] md:hidden">TeamIntel</p>
              <h2 className="mt-2 text-3xl font-semibold text-[#F4F1EB]">Sign in</h2>
              <p className="mt-2 text-sm text-[#B9B2A6]">Use your TeamIntel account to continue.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-xl border border-[#6B2B2B] bg-[#2A1717] px-3 py-2 text-sm text-[#F1A2A2]">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium text-[#D7D0C4]">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="h-11 w-full rounded-lg border border-white/15 bg-[#101311] px-3 text-sm text-[#F4F1EB] placeholder:text-[#8E877A] outline-none transition focus:border-[#2E7040]/70 focus:ring-2 focus:ring-[#2E7040]/50"
                  placeholder="you@teamintel.com"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-[#D7D0C4]">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="h-11 w-full rounded-lg border border-white/15 bg-[#101311] px-3 text-sm text-[#F4F1EB] placeholder:text-[#8E877A] outline-none transition focus:border-[#2E7040]/70 focus:ring-2 focus:ring-[#2E7040]/50"
                  placeholder="Enter your password"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="h-11 w-full text-sm font-medium text-white hover:opacity-95"
                style={{ backgroundColor: FOREST_GREEN }}
              >
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
