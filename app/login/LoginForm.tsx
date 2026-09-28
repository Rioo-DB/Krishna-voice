"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { INVOCATIONS } from "@/lib/krishna";

const DWELL_MS = 12_000;

export default function LoginForm({ linkError }: { linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? "That sign-in link has expired. Ask for a new one." : null,
  );
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  // Verse crossfades every 12 s; paused on hover/focus, static in reduced motion
  useEffect(() => {
    if (paused || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % INVOCATIONS.length), DWELL_MS);
    return () => clearInterval(t);
  }, [paused]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  const inv = INVOCATIONS[i];
  const [first, ...rest] = inv.sa.split(" ");

  return (
    <main className="frame">
      <div className="signin">
        <section
          className="signin__verse"
          aria-label="A verse from the Bhagavad Gita"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div className="signin__verse-body" key={inv.ref}>
            <span className="sc">Gita {inv.ref}</span>
            <p className="skt" lang="sa">
              {first}
              {rest.length > 0 && <><br />{rest.join(" ")}</>}
            </p>
            <p className="signin__en">{inv.en}</p>
          </div>
          <div className="dashes">
            {INVOCATIONS.map((v, n) => (
              <button key={v.ref} aria-label={`Gita ${v.ref}`} aria-current={n === i} onClick={() => setI(n)} />
            ))}
          </div>
        </section>

        <div className="convo__divider" />

        <section className="signin__form">
          <span className="om" lang="sa" aria-hidden="true">ॐ</span>
          <h1 className="disp">Talk to Krishna</h1>
          <div className="signin__mark">
            <span className="om" lang="sa" aria-hidden="true">ॐ</span>
            <span className="wm">Talk to Krishna</span>
          </div>
          {sent ? (
            <p className="srf" role="status">
              Check your inbox. A sign-in link is on its way to {email}.
            </p>
          ) : (
            <form onSubmit={send}>
              <label className="field">
                <span className="sc">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <button className="pill" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
            </form>
          )}
          {error && <p className="meta meta--lg" role="alert" style={{ color: "var(--ink)" }}>{error}</p>}
          <p className="meta" style={{ fontSize: 13 }}>A spoken conversation, grounded in the Bhagavad Gita.</p>
        </section>
      </div>
    </main>
  );
}
