"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fal } from "@fal-ai/client";
import { createClient } from "@/lib/supabase/client";
import { KRISHNA_PROMPT } from "@/lib/krishna";
import { floatToPcm16Base64, levelOf, PcmPlayer, SAMPLE_RATE } from "@/lib/audio";
import { TRY_MODE } from "@/lib/mode";
import Orb, { type OrbState } from "@/components/Orb";

type Item =
  | { kind: "line"; id: string; who: "you" | "krishna"; text: string }
  | { kind: "card"; id: string; source: string; text: string; sanskrit?: string };
type Phase = "idle" | "connecting" | "live";
type Mood = "idle" | "listening" | "speaking" | "thinking" | "remembering";
type Problem = { kind: "mic" | "connection" | "quota" | "other"; message?: string };
type GrokEvent = { type: string } & Record<string, unknown>;
type Connection = { send: (event: GrokEvent) => void; close: () => void };

const APP = "xai/grok-voice/realtime";
const KEYTERMS = [
  "Krishna", "Arjuna", "Bhagavad Gita", "Gita", "dharma", "karma", "karma yoga", "bhakti",
  "Kurukshetra", "atman", "moksha", "yoga", "Keshava", "Madhava", "Govinda", "Partha",
];
const DEBUG_EVENTS = process.env.NODE_ENV !== "production"; // logs each new event type once

// A function tool: Grok asks, the browser answers from /api/search
const TOOLS = [
  {
    type: "function",
    name: "search_scriptures",
    description:
      "Search Krishna's scriptures: the Bhagavad Gita (701 verses), the stories of his life " +
      "(Vishnu Purana, Harivamsha, Bhagavata, Mahabharata) and his other teachings (Anugita, " +
      "his Mahabharata speeches). Returns passages with their sources.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short English keywords, e.g. 'Govardhan hill Indra rain'" },
        collection: {
          type: "string",
          enum: ["gita", "life", "teachings"],
          description: "Optional: limit to the Gita, life stories, or other teachings",
        },
      },
      required: ["query"],
    },
  },
];

const STATUS: Record<Mood, string> = {
  idle: "Begin when you are ready",
  listening: "Krishna is listening",
  thinking: "Krishna is reflecting…",
  remembering: "Krishna is remembering…",
  speaking: "Krishna is speaking · speak anytime to interrupt",
};

// Speaking: 80 ms attack, 240 ms release (per ~16 ms frame)
const ATTACK = 1 - Math.exp(-16 / 80);
const RELEASE = 1 - Math.exp(-16 / 240);

export default function KrishnaVoice({ voice }: { voice: string }) {
  const [supabase] = useState(() => (TRY_MODE ? null : createClient()));
  const [phase, setPhase] = useState<Phase>("idle");
  const [mood, setMood] = useState<Mood>("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const conn = useRef<Connection | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const convoId = useRef<string | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const seenTypes = useRef(new Set<string>());
  const greeted = useRef(false);
  const configure = useRef<GrokEvent | null>(null);
  // xAI sends "completed" several times per utterance, so the seeker's words are
  // saved once: when Krishna starts replying, or when the call ends
  const pendingUser = useRef<{ id: string; text: string } | null>(null);

  // ---- remaining minutes -----------------------------------------------------
  const refreshQuota = useCallback(async () => {
    const r = await fetch("/api/quota").catch(() => null);
    if (!r?.ok) return null;
    const q = (await r.json()) as { remaining: number | null };
    setRemaining(q.remaining);
    return q.remaining;
  }, []);
  useEffect(() => {
    fetch("/api/quota")
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => q && setRemaining(q.remaining))
      .catch(() => {});
  }, []);

  // ---- orb: both voice levels as CSS variables, without re-rendering React ---
  useEffect(() => {
    let raf = 0;
    const scratch = new Float32Array(512);
    let k = 0, u = 0, lastK = "", lastU = "";
    const tick = () => {
      const kNow = player.current ? levelOf(player.current.analyser, scratch) : 0;
      const uNow = micAnalyser.current ? levelOf(micAnalyser.current, scratch) : 0;
      k += (kNow - k) * (kNow > k ? ATTACK : RELEASE);
      u += (uNow - u) * (uNow > u ? ATTACK : RELEASE);
      // only touch the DOM when a level visibly changes, so an idle page stays idle
      const kS = k.toFixed(2), uS = u.toFixed(2);
      if (kS !== lastK) root.current?.style.setProperty("--k", (lastK = kS));
      if (uS !== lastU) root.current?.style.setProperty("--u", (lastU = uS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    pane.current?.scrollTo({ top: pane.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  const save = useCallback(
    async (role: "user" | "krishna", content: string) => {
      if (!supabase || !convoId.current || !content.trim()) return;
      await supabase.from("messages").insert({ conversation_id: convoId.current, role, content });
    },
    [supabase],
  );

  const upsertLine = (id: string, who: "you" | "krishna", text: string, append = false) =>
    setItems((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i === -1) return [...prev, { kind: "line", id, who, text }];
      const next = [...prev];
      const cur = next[i];
      next[i] = { ...cur, text: append ? cur.text + text : text };
      return next;
    });

  const flushUser = useCallback(() => {
    const p = pendingUser.current;
    pendingUser.current = null;
    if (p?.text.trim()) save("user", p.text);
  }, [save]);

  /** Runs Grok's search_scriptures call and hands the passages back to it. */
  const answerSearch = useCallback(async (callId: string, rawArgs: string) => {
    setMood("remembering");
    let output: unknown;
    try {
      const args = JSON.parse(rawArgs || "{}");
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = (await r.json()) as { results?: { source: string; text: string; sanskrit?: string }[]; note?: string };
      // fal drops the socket on large client messages (~6 KB failed, ~2 KB works),
      // so Grok gets the top 3 passages, trimmed, without Sanskrit
      output = {
        results: (data.results ?? []).slice(0, 3).map((p) => ({ source: p.source, text: p.text.slice(0, 600) })),
        note: data.note,
      };
      // Show the passage Krishna most likely drew on, in the thread where he uses it
      const top = data.results?.[0];
      if (top) {
        setItems((prev) =>
          prev.some((it) => it.kind === "card" && it.text === top.text)
            ? prev
            : [...prev, { kind: "card", id: `card-${callId}`, ...top }],
        );
      }
    } catch {
      output = { error: "Search failed. Answer without citing a source." };
    }
    conn.current?.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
    });
    conn.current?.send({ type: "response.create" });
  }, []);

  // ---- start / stop ----------------------------------------------------------
  const stop = useCallback(async () => {
    flushUser();
    if (capTimer.current) clearTimeout(capTimer.current);
    capTimer.current = null;
    conn.current?.close();
    conn.current = null;
    player.current?.stop();
    player.current = null;
    micAnalyser.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    await ctx.current?.close().catch(() => {});
    ctx.current = null;
    if (supabase && convoId.current) {
      const id = convoId.current;
      convoId.current = null;
      await supabase.from("conversations").update({ ended_at: new Date().toISOString() }).eq("id", id);
    }
    setPhase("idle");
    setMood("idle");
    refreshQuota();
  }, [supabase, refreshQuota, flushUser]);

  // ---- events from Grok (relayed verbatim by fal) ----------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onEvent = useCallback((ev: any) => {
    if (DEBUG_EVENTS && ev?.type && !seenTypes.current.has(ev.type)) {
      seenTypes.current.add(ev.type);
      console.log("[grok event]", ev.type, ev);
    }
    switch (ev?.type) {
      case "session.created":
        // Re-send the persona now the socket is open, in case the queued copy was lost
        if (!greeted.current && configure.current) conn.current?.send(configure.current);
        break;
      case "session.updated":
        if (conn.current && ctx.current) {
          if (!greeted.current) {
            greeted.current = true;
            // Native xAI fields (fal's configure event doesn't cover them): the scripture
            // search tool, and live transcription of the seeker biased toward names and
            // Sanskrit terms
            conn.current.send({
              type: "session.update",
              session: {
                tools: TOOLS,
                audio: { input: { transcription: { model: "grok-transcribe", keyterms: KEYTERMS } } },
              },
            });
            conn.current.send({ type: "response.create" }); // triggers the greeting
          }
          setPhase("live");
          setMood("listening");
        }
        break;
      case "input_audio_buffer.speech_started":
        player.current?.stop(); // barge-in
        setMood("listening");
        if (ev.item_id) {
          if (pendingUser.current && pendingUser.current.id !== ev.item_id) flushUser();
          upsertLine(ev.item_id, "you", ""); // live caption, fills as they speak
        }
        break;
      case "input_audio_buffer.speech_stopped":
        setMood("thinking");
        break;
      case "conversation.item.input_audio_transcription.updated": // cumulative, may self-correct
      case "conversation.item.input_audio_transcription.completed": {
        const text = (ev.transcript ?? "").trim();
        if (text) {
          upsertLine(ev.item_id, "you", text);
          pendingUser.current = { id: ev.item_id, text };
        }
        break;
      }
      case "response.created":
        flushUser();
        setItems((prev) => prev.filter((it) => it.text !== "")); // noise, not speech
        break;
      case "response.output_audio.delta":
        player.current?.play(ev.delta);
        setMood("speaking");
        break;
      case "response.output_audio_transcript.delta":
        upsertLine(ev.item_id ?? ev.response_id, "krishna", ev.delta ?? "", true);
        break;
      case "response.output_audio_transcript.done":
        upsertLine(ev.item_id ?? ev.response_id, "krishna", ev.transcript ?? "");
        save("krishna", ev.transcript ?? "");
        break;
      case "response.function_call_arguments.done":
        if (ev.name === "search_scriptures") answerSearch(ev.call_id, ev.arguments);
        break;
      case "response.done":
        setMood((m) => (m === "remembering" ? m : "listening"));
        break;
      case "error":
        console.warn("Grok error", ev);
        break;
    }
  }, [save, flushUser, answerSearch]);

  const start = useCallback(async () => {
    setProblem(null);
    greeted.current = false;
    setPhase("connecting");
    setMood("thinking");
    try {
      // AudioContext must be created inside the click (iOS needs a user gesture)
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      ctx.current = audioCtx;
      player.current = new PcmPlayer(audioCtx);

      const left = await refreshQuota();
      if (left != null && left <= 0) throw Object.assign(new Error("quota"), { name: "QuotaError" });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      mic.current = stream;

      // Record the session start (used for the daily quota)
      if (supabase) {
        const { data: convo, error: cErr } = await supabase.from("conversations").insert({}).select("id").single();
        if (cErr) throw cErr;
        convoId.current = convo.id;
      }

      // Hard cap: end the call when today's minutes run out
      if (left != null) capTimer.current = setTimeout(() => {
        setProblem({ kind: "quota" });
        stop();
      }, left * 60_000);

      const connection = fal.realtime.connect<GrokEvent>(APP, {
        throttleInterval: 0, // default throttling drops audio chunks
        tokenExpirationSeconds: 120,
        tokenProvider: async (app) => {
          const r = await fetch("/api/fal/realtime-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ app }),
          });
          const text = await r.text();
          if (r.status === 429) setProblem({ kind: "quota" });
          if (!r.ok) throw new Error(text);
          return text;
        },
        onResult: onEvent,
        onError: () => {
          setProblem((p) => p ?? { kind: "connection" });
          stop();
        },
      });
      conn.current = connection;

      // fal connects lazily on the first send, and while connecting it holds only ONE
      // pending message (later sends overwrite it). So the mic stays muted until
      // session.updated. Persona, voice and turn detection go on fal's own
      // configure event (they're rejected on session.update).
      configure.current = {
        type: "x-fal-session.configure",
        prompt: KRISHNA_PROMPT,
        voice,
        // a little patience: people pause mid-thought when sharing something hard
        turn_detection: { silence_duration_ms: 900, prefix_padding_ms: 300 },
      };
      connection.send(configure.current);

      // Stream the mic up in 100 ms chunks
      await audioCtx.audioWorklet.addModule("/pcm-recorder.js");
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      micAnalyser.current = analyser;
      const recorder = new AudioWorkletNode(audioCtx, "pcm-recorder");
      recorder.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!greeted.current) return; // session not configured yet (see above)
        conn.current?.send({ type: "input_audio_buffer.append", audio: floatToPcm16Base64(e.data) });
      };
      source.connect(recorder);
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setProblem(
        err?.name === "NotAllowedError" ? { kind: "mic" }
          : err?.name === "QuotaError" ? { kind: "quota" }
            : err?.name === "NotSupportedError"
              ? { kind: "other", message: "This browser can't record at 24 kHz. Please use Chrome, Edge or Safari." }
              : { kind: "other", message: err?.message ?? "Could not start the conversation." },
      );
      stop();
    }
  }, [onEvent, stop, supabase, refreshQuota, voice]);

  useEffect(() => () => { stop(); }, [stop]);

  // ---- render ----------------------------------------------------------------
  const live = phase !== "idle";
  const orbState: OrbState =
    phase === "connecting" ? "connect"
      : !live ? "idle"
        : ({ idle: "idle", listening: "listen", thinking: "idle", remembering: "remember", speaking: "speak" } as const)[mood];
  const status = phase === "connecting" ? "Connecting…" : STATUS[live ? mood : "idle"];
  const minutes = remaining != null && <span className="meta">{Math.max(0, Math.floor(remaining))} minutes left today</span>;
  const shown = items.filter((it) => it.kind === "card" || it.text || it.who === "you");
  const last = shown[shown.length - 1];

  return (
    <div ref={root} className={`convo ${live ? "convo--live" : ""}`}>
      <section className="presence" aria-label="Krishna">
        {problem && !live ? (
          <ProblemView problem={problem} onRetry={start} />
        ) : (
          <>
            <div className="presence__full">
              <h1 className="disp">Speak, and be heard.</h1>
              <Orb state={orbState} />
              <p className="status" aria-live="polite">{status}</p>
              <div className="presence__actions">
                {live ? (
                  <button className="pill pill--o" onClick={stop} disabled={phase === "connecting"}>End conversation</button>
                ) : (
                  <button className="pill" onClick={start}>Begin conversation</button>
                )}
                {minutes}
                {TRY_MODE && !live && <span className="meta">Try mode · conversations are not saved</span>}
              </div>
            </div>
            <div className="presence__compact">
              <Orb state={orbState} />
              <div className="presence__compact-text">
                <p className="status" aria-live="polite">{status}</p>
                {minutes}
              </div>
              <button className="pill pill--o pill--sm" onClick={stop} disabled={phase === "connecting"}>End</button>
            </div>
          </>
        )}
      </section>

      <div className="convo__divider" />

      <div className="thread-pane" ref={pane}>
        <div className="thread" aria-live="polite">
          {shown.length === 0 ? (
            <div className="thread__intro">
              <span className="sc">How it works</span>
              <p className="meta meta--lg">
                Press begin, allow the microphone, and speak freely, in English, Hindi or Hinglish. Krishna listens,
                remembers the scriptures, and answers aloud. Speak anytime to interrupt.
              </p>
            </div>
          ) : (
            shown.map((it) =>
              it.kind === "card" ? (
                <article key={it.id} className="card fade-in">
                  <span className="sc">{it.source}</span>
                  {it.sanskrit && <span className="skt" lang="sa">{it.sanskrit}</span>}
                  <span className="srf">{it.text.length > 360 ? `${it.text.slice(0, 360).trimEnd()}…` : it.text}</span>
                </article>
              ) : (
                <p
                  key={it.id}
                  className={`fade-in ${it.who === "krishna" ? "kr" : `me ${it === last && live ? "me--live" : ""}`}`}
                >
                  {it.text}
                  {it === last && live && (mood === "speaking" || it.who === "you") && <span className="caret" />}
                </p>
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ProblemView({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  if (problem.kind === "quota")
    return (
      <div className="presence__error">
        <Orb state="still" />
        <p className="kr" style={{ textAlign: "center" }}>You&apos;ve used today&apos;s minutes. Come back tomorrow.</p>
        <span className="meta">0 minutes left today</span>
        {!TRY_MODE && <Link className="lnk lnk--u" href="/history">Read your conversations</Link>}
      </div>
    );
  if (problem.kind === "mic")
    return (
      <div className="presence__error">
        <span className="sc">Mic blocked</span>
        <Orb state="dim" />
        <p className="status status--ink">Krishna can&apos;t hear you yet.</p>
        <p className="meta meta--lg">
          Your microphone is blocked. Allow it from the icon in your browser&apos;s address bar (on iPhone: Settings ›
          Safari › Microphone), then try again.
        </p>
        <div className="presence__error-actions">
          <button className="pill pill--sm" onClick={onRetry}>Try again</button>
        </div>
      </div>
    );
  return (
    <div className="presence__error">
      <span className="sc">{problem.kind === "connection" ? "Connection lost" : "Something went wrong"}</span>
      <Orb state="dim" />
      <p className="status status--ink">The connection has gone quiet.</p>
      <p className="meta meta--lg">{problem.message ?? "Everything said so far is kept below."}</p>
      <button className="pill pill--o pill--sm" onClick={onRetry}>Reconnect now</button>
    </div>
  );
}
