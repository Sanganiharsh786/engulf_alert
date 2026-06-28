"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.location.href = "/";
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-border bg-panel p-6 space-y-5 shadow-2xl"
      >
        <div className="text-center space-y-1">
          <div className="mx-auto h-10 w-10 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent text-lg font-bold">
            ⚡
          </div>
          <h1 className="text-lg font-bold tracking-tight">Engulfing Alerts</h1>
          <p className="text-xs text-muted">Sign in to your dashboard</p>
        </div>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            className="mt-1 w-full bg-panel2 border border-border rounded-md px-3 py-2 outline-none focus:border-accent/60"
          />
        </label>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full bg-panel2 border border-border rounded-md px-3 py-2 outline-none focus:border-accent/60"
          />
        </label>

        {error && (
          <div className="text-xs text-bear bg-bear/10 border border-bear/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full text-sm px-3 py-2.5 rounded-md bg-accent text-white font-medium hover:brightness-110 transition disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
