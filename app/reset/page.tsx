"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Reached from the reset email (via /auth/callback, which signs the person in): set a new password. */
export default function Reset() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("session")
          ? "This reset link has expired. Ask for a new one from the sign-in page."
          : error.message,
      );
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="frame">
      <div className="empty">
        <span className="om" lang="sa" aria-hidden="true">ॐ</span>
        <h1 className="disp" style={{ fontSize: 40 }}>Set a new password</h1>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 24, width: 320, maxWidth: "100%" }}>
          <label className="field" style={{ textAlign: "left" }}>
            <span className="sc">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <button className="pill" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
        </form>
        {error && <p className="meta meta--lg" role="alert" style={{ color: "var(--ink)" }}>{error}</p>}
        <Link className="lnk lnk--u" href="/login">Back to sign in</Link>
      </div>
    </main>
  );
}
