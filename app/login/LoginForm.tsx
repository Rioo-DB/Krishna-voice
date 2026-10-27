"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { INVOCATIONS } from "@/lib/verses";

const DWELL_MS = 12_000;
type Mode = "signin" | "signup" | "forgot";

const TITLE: Record<Mode, string> = { signin: "Sign in", signup: "Create your account", forgot: "Reset your password" };
const SUBMIT: Record<Mode, [string, string]> = {
  signin: ["Sign in", "Signing in…"],
  signup: ["Create account", "Creating…"],
  forgot: ["Email me a reset link", "Sending…"],
};

export default function LoginForm({ linkError, usernamesEnabled }: { linkError: boolean; usernamesEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    linkError ? "That link has expired or was already used. Please try again." : null,
  );
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  // Verse crossfades every 12 s; paused on hover/focus, static in reduced motion
  useEffect(() => {
    if (paused || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % INVOCATIONS.length), DWELL_MS);
    return () => clearInterval(t);
  }, [paused]);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const auth = createClient().auth;
    const callback = (next: string) => `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "signin") {
        // on the server, which turns a username into its account's email
        const r = await fetch("/auth/signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login: email, password }),
        });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error);
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      if (mode === "signup") {
        const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: callback("/dashboard") } });
        if (error) throw error;
        if (data.session) {
          router.replace("/dashboard");
          router.refresh();
          return;
        }
        // Supabase asks new accounts to confirm their email first
        setNotice(`Almost there. Open the link we sent to ${email} to confirm your account, then sign in.`);
        setMode("signin");
        setPassword("");
        return;
      }
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: callback("/reset") });
      if (error) throw error;
      setNotice(`If ${email} has an account, a link to set a new password is on its way.`);
    } catch (err) {
      setError((err as { message?: string }).message ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inv = INVOCATIONS[i];
  const [first, ...rest] = inv.sa.split(" ");
  const [label, busyLabel] = SUBMIT[mode];

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
          <span className="sc">{TITLE[mode]}</span>
          <form onSubmit={submit}>
            <label className="field">
              <span className="sc">{mode === "signin" && usernamesEnabled ? "Email or username" : "Email"}</span>
              <input
                type={mode === "signin" && usernamesEnabled ? "text" : "email"}
                required
                autoComplete={mode === "signin" ? "username" : "email"}
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {mode !== "forgot" && (
              <label className="field">
                <span className="sc">Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : ""}
                />
              </label>
            )}
            <button className="pill" disabled={busy}>{busy ? busyLabel : label}</button>
          </form>
          {notice && <p className="srf" role="status">{notice}</p>}
          {error && <p className="meta meta--lg" role="alert" style={{ color: "var(--ink)" }}>{error}</p>}
          <p className="meta" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {mode === "signin" ? (
              <>
                <button type="button" className="lnk lnk--u" onClick={() => switchTo("signup")}>Create an account</button>
                <button type="button" className="lnk lnk--u" onClick={() => switchTo("forgot")}>Forgot password?</button>
              </>
            ) : (
              <button type="button" className="lnk lnk--u" onClick={() => switchTo("signin")}>Back to sign in</button>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
