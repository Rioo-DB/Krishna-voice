"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fal } from "@fal-ai/client";
import { KRISHNA_PROMPT } from "@/lib/krishna";
import { floatToPcm16Base64, levelOf, PcmPlayer, SAMPLE_RATE } from "@/lib/audio";
import Orb, { type OrbState } from "@/components/Orb";

type Item =
  | { kind: "line"; id: string; who: "you" | "krishna"; text: string }
  | { kind: "card"; id: string; source: string; text: string; sanskrit?: string };
type Phase = "idle" | "connecting" | "live";
type Mood = "idle" | "standby" | "listening" | "speaking" | "thinking" | "remembering";
type Problem = { kind: "mic" | "connection" | "quota" | "other"; message?: string };
type GrokEvent = { type: string } & Record<string, unknown>;
type Connection = { send: (event: GrokEvent) => void; close: () => void };

const APP = "xai/grok-voice/realtime";
const KEYTERMS = [
  "Krishna", "Arjuna", "Bhagavad Gita", "Gita", "dharma", "karma", "karma yoga", "bhakti",
  "Kurukshetra", "atman", "moksha", "yoga", "Keshava", "Madhava", "Govinda", "Partha",
];
// While Krishna speaks, only these stop him at once; "okay okay" and the like
// don't, and two or more other words count as a real interruption
const STOP_RE = /\b(stop|wait|listen|hold on|cancel|never ?mind|enough|shut up|one (minute|second|sec)|ruko|ruk|suno|bas|chup|ek (minute|min|second))\b|रुको|रुक|सुनो|बस|चुप|एक मिनट/i;
const BACKCHANNEL = new Set(
  ("ok okay okk okey hmm hm hmmm mm mhm uh huh yes yeah yep yup right sure fine good nice i see got it true " +
    "haan han ha haa ji accha acha achha achchha thik theek hai sahi wah " +
    "हाँ हां हा जी अच्छा ठीक है सही वाह ओके").split(" "),
);
type Heard = "stop" | "backchannel" | "speech";
function classify(text: string): Heard {
  if (STOP_RE.test(text)) return "stop";
  const words = text.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  return words.filter((w) => !BACKCHANNEL.has(w)).length >= 2 ? "speech" : "backchannel";
}

// ---- wake word: like Alexa, Krishna sleeps until he hears his name ----------
// Heard by the browser's own speech recogniser (en-IN), which never reaches Grok.
// Grok only gets audio once awake, starting with a short pre-roll so "Krishna, ..." arrives whole.
const WAKE_RE = /\b(krishna(a|ji)?|krsna|krisna|krishan|kishan|kanha|kanhaiya)\b|कृष्ण|क्रिष्ण|किशन|कान्हा/i;
// Asleep, his name alone isn't enough: he wakes on "Hey Krishna", "Krishna, listen to me",
// or a call for help ("Krishna, help me", "Krishna, bachao"): someone in distress must never go unheard
const CALL_RE =
  /\b(hey|hi|hello|hay|he|ok|okay)\W*(krishna|krsna|krisna|krishan|kishan|kanha)|\b(listen|suno|suniye|sunno|sun lo|talk to me|baat karo|baat karni|help|save me|please|bachao|bachaiye|madad)\b|(हे|हाय)\s*(कृष्ण|कान्हा)|सुनो|सुनिए|सुन लो|बात करो|बचाओ|बचाइए|मदद/i;
// Awake, "Krishna" with one of these sends him back to sleep: "Krishna, okay, understood, thank you"
const DISMISS_RE =
  /\b(understood|thank you|thanks|thankyou|don'?t want to talk|do not want to talk|that'?s all|that is all|bye|goodbye|good night|dhanyavad|dhanyawad|shukriya|samajh gaya|samajh gayi|samjh gaya|ho gaya)\b|धन्यवाद|शुक्रिया|समझ गया|समझ गई/i;
// Recogniser errors that won't fix themselves; on these, hands-free mode gives way to always listening
const FATAL_RECOGNITION = new Set(["not-allowed", "service-not-allowed", "network", "audio-capture", "language-not-supported"]);
const PRE_ROLL_CHUNKS = 60; // 3 s of 50 ms mic chunks kept while asleep: "Krishna, listen to me" and the recogniser's lag
const CONNECT_ROLL_CHUNKS = 200; // 10 s held while the socket reopens
// Awake, he stays in the conversation until dismissed; this much silence on both sides also ends it
const FOLLOW_UP_MS = 2 * 60_000;
const STANDBY_CLOSE_MS = 3 * 60_000; // an idle socket closes, and reopens on the next "Krishna"
const WAKE_NOTE = `
HANDS-FREE MODE (this overrides HOW YOU LISTEN, HOW YOU SPEAK, the greeting, and ending stories with a question)
- You are on a hands-free voice device. The seeker wakes you by saying "Hey Krishna" or "Krishna, listen to me"; that is only them calling you, never comment on it, and do not greet.
- The conversation then continues until they dismiss you ("Krishna, understood", "Krishna, thank you"); the device handles that, so never say goodbye or ask whether they are done.
- Answer what they asked straight away: put the answer in your first sentence, keep it to one to three short spoken sentences, and end cleanly. Do not ask a follow-up question unless you truly need an answer to help; if they want more, they will ask.
- If they only called you ("Hey Krishna") and nothing else, reply with just "Yes, I am listening." (or "Haan, boliye." in Hindi) and wait.
- If they say "stop", "cancel" or "never mind", say nothing more than "Okay." (not "Yes, I am listening").
- Safety comes first and outranks everything in this section: if the seeker speaks of wanting to die, self-harm, abuse, danger to anyone, or a medical emergency, follow HONESTY AND CARE in full: ask directly, give the helplines, stay with them, take as many sentences as care needs, and never stop to say "Okay." For other feelings and heavy matters, stay warm and gentle.
- Never call yourself a device, an assistant or any product; you are an AI voice inspired by the Bhagavad Gita.`.trim();

type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const recognizerClass = () => {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognizer) | undefined;
};

/** Alexa-style tones: rising when Krishna wakes, falling when he goes back to sleep. */
function chime(ac: AudioContext | null, up: boolean) {
  if (!ac || ac.state !== "running") return;
  (up ? [660, 880] : [880, 587]).forEach((f, i) => {
    const t = ac.currentTime + i * 0.12;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 0.3);
  });
}

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

/**
 * xAI-managed live search for news and trends. These must travel in the same
 * session.update as search_scriptures: a tools list replaces the whole list, so
 * sending them separately (e.g. on fal's configure event) would wipe one or the other.
 */
const liveSearchTools = () => {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  return [
    { type: "web_search", location: { country: "IN" } },
    { type: "x_search", from_date: weekAgo },
  ];
};

const STATUS: Record<Mood, string> = {
  idle: "Begin when you are ready",
  standby: "Say “Hey Krishna” to talk",
  listening: "Krishna is listening",
  thinking: "Krishna is reflecting…",
  remembering: "Krishna is remembering…",
  speaking: "Krishna is speaking · speak anytime to interrupt",
};

// Speaking: 80 ms attack, 240 ms release (per ~16 ms frame)
const ATTACK = 1 - Math.exp(-16 / 80);
const RELEASE = 1 - Math.exp(-16 / 240);

const TOKEN_SECONDS = 120;

/** Mints a fal token via /api/fal/realtime-token (which checks the daily quota). */
async function fetchToken(app: string) {
  const r = await fetch("/api/fal/realtime-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app }),
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(text), { status: r.status });
  return text;
}

/** POSTs to /api/convo, which saves to Supabase scoped to this browser's device cookie. */
const convoApi = (body: object) =>
  fetch("/api/convo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true, // lets "end" finish while the tab closes
  });

export default function KrishnaVoice({ voice, saving }: { voice: string; saving: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mood, setMood] = useState<Mood>("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

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
  // resolves once the mic is live and the conversation is recorded; the greeting waits for it
  const ready = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  // xAI sends "completed" several times per utterance, so the seeker's words are
  // saved once: when Krishna starts replying, or when the call ends
  const pendingUser = useRef<{ id: string; text: string } | null>(null);
  // wake word state: without a browser speech recogniser, wakeMode stays off and he is always awake
  const wakeMode = useRef(false);
  const awake = useRef(true);
  const roll = useRef<Float32Array[]>([]); // mic chunks not yet sent to Grok
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recog = useRef<Recognizer | null>(null);
  const pausedRef = useRef(false);
  const stopLatest = useRef(() => {}); // stop(), for callbacks defined before it
  const wakeGen = useRef(0); // bumped on every sleep and stop, so a slow startRecord can tell it's stale
  const currentResponse = useRef<string | null>(null);
  const droppedResponse = useRef<string | null>(null); // interrupted: its late audio is ignored
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // ---- fal token, minted ahead so Begin doesn't wait ~1 s for it --------------
  const prefetched = useRef<{ at: number; token: Promise<string> } | null>(null);
  const prefetchToken = useCallback(() => {
    const p = prefetched.current;
    if (p && Date.now() - p.at < 90_000) return; // still has 30 s+ of its 120 s life
    const token = fetchToken(APP);
    token.catch(() => {}); // a failed prefetch just means Begin mints its own
    prefetched.current = { at: Date.now(), token };
  }, []);
  useEffect(() => { prefetchToken(); }, [prefetchToken]);

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
      if (!convoId.current || !content.trim()) return;
      await convoApi({ action: "message", id: convoId.current, role, content }).catch(() => {});
    },
    [],
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
    wakeGen.current++;
    flushUser();
    if (capTimer.current) clearTimeout(capTimer.current);
    capTimer.current = null;
    [sleepTimer, closeTimer].forEach((t) => { if (t.current) clearTimeout(t.current); t.current = null; });
    const r = recog.current;
    recog.current = null; // before abort, so its onend doesn't restart it
    r?.abort();
    roll.current = [];
    wakeMode.current = false;
    awake.current = true;
    conn.current?.close();
    conn.current = null;
    player.current?.stop();
    player.current = null;
    micAnalyser.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    await ctx.current?.close().catch(() => {});
    ctx.current = null;
    if (convoId.current) {
      const id = convoId.current;
      convoId.current = null;
      await convoApi({ action: "end", id }).catch(() => {});
    }
    setPhase("idle");
    setMood("idle");
    setPaused(false);
    pausedRef.current = false;
    refreshQuota();
  }, [refreshQuota, flushUser]);
  useEffect(() => { stopLatest.current = () => { stop(); }; }, [stop]);

  // ---- the conversation record: its minutes count toward the daily quota -----
  // Hands-free, a record covers one waking (standby time doesn't count), like Alexa's voice history.
  const startRecord = useCallback(async (known?: number | null) => {
    const gen = wakeGen.current;
    const left = known !== undefined ? known : await refreshQuota();
    if (left != null && left <= 0) throw Object.assign(new Error("quota"), { name: "QuotaError" });
    const started = await convoApi({ action: "start" });
    if (started.status === 429) throw Object.assign(new Error("quota"), { name: "QuotaError" });
    const id = ((await started.json().catch(() => ({}))) as { id?: string | null }).id ?? null;
    if (gen !== wakeGen.current) {
      // he went back to sleep (or the session ended) while this was in flight
      if (id) convoApi({ action: "end", id }).catch(() => {});
      return;
    }
    convoId.current = id;
    // Hard cap: end the call when today's minutes run out
    if (capTimer.current) clearTimeout(capTimer.current);
    capTimer.current = left != null ? setTimeout(() => {
      setProblem({ kind: "quota" });
      stopLatest.current();
    }, left * 60_000) : null;
  }, [refreshQuota]);

  const endRecord = useCallback(() => {
    wakeGen.current++;
    flushUser();
    if (capTimer.current) clearTimeout(capTimer.current);
    capTimer.current = null;
    const id = convoId.current;
    convoId.current = null;
    if (id) convoApi({ action: "end", id }).catch(() => {});
  }, [flushUser]);

  /** For failures after Begin (a waking, a reconnect): show why and end the session. */
  const failLive = useCallback((e: unknown) => {
    const err = e as { name?: string; status?: number };
    setProblem((p) => p ?? (err?.name === "QuotaError" || err?.status === 429 ? { kind: "quota" } : { kind: "connection" }));
    stopLatest.current();
  }, []);

  // ---- sleeping and waking ---------------------------------------------------
  /** Asleep, an open socket is closed after a while; the next "Krishna" reopens it. */
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (awake.current) return;
      const c = conn.current;
      conn.current = null; // first, so its onError is ignored
      greeted.current = false;
      c?.close();
    }, STANDBY_CLOSE_MS);
  }, []);

  const goToSleep = useCallback(() => {
    if (!wakeMode.current || !awake.current) return;
    awake.current = false;
    roll.current = [];
    conn.current?.send({ type: "input_audio_buffer.clear" });
    chime(ctx.current, false);
    setMood("standby");
    endRecord();
    scheduleClose();
  }, [scheduleClose, endRecord]);

  /** Back to sleep once he has been quiet, and the seeker silent, for FOLLOW_UP_MS. */
  const armSleep = useCallback(() => {
    if (!wakeMode.current) return;
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    let quietSince = Date.now();
    const check = () => {
      if (player.current?.isPlaying) quietSince = Date.now(); // his reply may still be playing
      if (Date.now() - quietSince >= FOLLOW_UP_MS) {
        sleepTimer.current = null;
        goToSleep();
      } else sleepTimer.current = setTimeout(check, 500);
    };
    sleepTimer.current = setTimeout(check, 500);
  }, [goToSleep]);

  const holdAwake = useCallback(() => {
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = null;
  }, []);

  /** Barge-in: silence him here and cancel the reply on Grok's side, so it can't resume mid-sentence. */
  const interrupt = useCallback(() => {
    player.current?.stop();
    droppedResponse.current = currentResponse.current;
    conn.current?.send({ type: "response.cancel" });
    setMood("listening");
  }, []);

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
            // Native xAI fields (fal's configure event doesn't cover them): the tools
            // (scripture search + live web/X search, one list), and live transcription of
            // the seeker biased toward names and Sanskrit terms
            conn.current.send({
              type: "session.update",
              session: {
                tools: [...TOOLS, ...liveSearchTools()],
                audio: { input: { transcription: { model: "grok-transcribe", keyterms: KEYTERMS } } },
              },
            });
            // greeting, except in hands-free mode, where he waits to be called
            const c = conn.current;
            ready.current?.promise.then(() => {
              if (conn.current === c && !wakeMode.current) c.send({ type: "response.create" });
            });
          }
          setPhase("live");
          setMood(awake.current ? "listening" : "standby");
          if (awake.current) armSleep(); // reopened by a waking: now the follow-up window can run
        }
        break;
      case "input_audio_buffer.speech_started":
        holdAwake();
        // Barge-in waits for the words (see classify): Krishna keeps speaking through "okay okay"
        if (!player.current?.isPlaying) setMood("listening");
        if (ev.item_id) {
          if (pendingUser.current && pendingUser.current.id !== ev.item_id) flushUser();
          upsertLine(ev.item_id, "you", ""); // live caption, fills as they speak
        }
        break;
      case "input_audio_buffer.speech_stopped":
        setMood("thinking");
        armSleep(); // in case it was only noise and no reply comes
        break;
      case "conversation.item.input_audio_transcription.updated": // cumulative, may self-correct
      case "conversation.item.input_audio_transcription.completed": {
        const text = (ev.transcript ?? "").trim();
        if (text) {
          upsertLine(ev.item_id, "you", text);
          pendingUser.current = { id: ev.item_id, text };
          if (player.current?.isPlaying && classify(text) !== "backchannel") interrupt();
        }
        break;
      }
      case "response.created":
        if (wakeMode.current && !awake.current) {
          // dismissed: Grok may still answer the "thank you" it heard; he stays silent
          conn.current?.send({ type: "response.cancel" });
          break;
        }
        holdAwake();
        currentResponse.current = ev.response?.id ?? null;
        flushUser();
        setItems((prev) => prev.filter((it) => it.text !== "")); // noise, not speech
        break;
      case "response.output_audio.delta":
        if (wakeMode.current && !awake.current) break; // asleep: never speaks
        if (ev.response_id && ev.response_id === droppedResponse.current) break;
        player.current?.play(ev.delta);
        setMood("speaking");
        break;
      case "response.output_audio_transcript.delta":
        if (wakeMode.current && !awake.current) break;
        if (ev.response_id && ev.response_id === droppedResponse.current) break; // words he never said
        upsertLine(ev.item_id ?? ev.response_id, "krishna", ev.delta ?? "", true);
        break;
      case "response.output_audio_transcript.done":
        if (wakeMode.current && !awake.current) break;
        if (ev.response_id && ev.response_id === droppedResponse.current) break;
        upsertLine(ev.item_id ?? ev.response_id, "krishna", ev.transcript ?? "");
        save("krishna", ev.transcript ?? "");
        break;
      case "response.function_call_arguments.done":
        if (wakeMode.current && !awake.current) break;
        if (ev.name === "search_scriptures") answerSearch(ev.call_id, ev.arguments);
        break;
      case "response.done":
        if (wakeMode.current && !awake.current) break;
        setMood((m) => (m === "remembering" ? m : "listening"));
        armSleep();
        break;
      case "error":
        console.warn("Grok error", ev);
        break;
    }
  }, [save, flushUser, answerSearch, armSleep, holdAwake, interrupt]);

  /**
   * Opens the Grok socket. fal connects lazily on the first send, and while
   * connecting it holds only ONE pending message (later sends overwrite it), so
   * mic audio waits in `roll` until session.updated. Persona, voice and turn
   * detection go on fal's own configure event (they're rejected on session.update).
   */
  const openSocket = useCallback(() => {
    greeted.current = false;
    const connection = fal.realtime.connect<GrokEvent>(APP, {
      throttleInterval: 0, // default throttling drops audio chunks
      tokenExpirationSeconds: TOKEN_SECONDS,
      tokenProvider: async (app) => {
        // use the prefetched token once, if it's fresh; refreshes mint a new one
        const p = prefetched.current;
        prefetched.current = null;
        try {
          if (p && Date.now() - p.at < 90_000) return await p.token.catch(() => fetchToken(app));
          return await fetchToken(app);
        } catch (e) {
          // fal goes quiet on a failed first token rather than calling onError, so end
          // here; a failed refresh of a working socket is left to fal's own retry
          if (conn.current === connection && !greeted.current) failLive(e);
          throw e;
        }
      },
      onResult: onEvent,
      onError: () => {
        if (conn.current !== connection) return; // closed on purpose while asleep
        failLive(null);
      },
    });
    conn.current = connection;

    // A reopened socket starts blank, so it carries the last few lines said
    const recent = itemsRef.current
      .flatMap((it) => (it.kind === "line" && it.text ? [`${it.who === "you" ? "Seeker" : "Krishna"}: ${it.text}`] : []))
      .slice(-8)
      .join("\n")
      .slice(-1500);
    configure.current = {
      type: "x-fal-session.configure",
      prompt: [
        KRISHNA_PROMPT,
        wakeMode.current && WAKE_NOTE,
        recent && `Earlier in this conversation (most recent last):\n${recent}`,
        // the model doesn't know today's date; without it news searches drift to past years
        `Today is ${new Date().toLocaleDateString("en-IN", { dateStyle: "full", timeZone: "Asia/Kolkata" })} (India time).`,
      ].filter(Boolean).join("\n\n"),
      voice,
      // every ms here is added to each reply; 900 felt slow, under ~500 cuts people off mid-thought
      turn_detection: { silence_duration_ms: 600, prefix_padding_ms: 300 },
    };
    connection.send(configure.current);
  }, [onEvent, failLive, voice]);

  const wake = useCallback(() => {
    if (!wakeMode.current || pausedRef.current || awake.current) return;
    awake.current = true;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    chime(ctx.current, true);
    setMood("listening");
    startRecord().catch(failLive);
    // if nothing follows the name, he goes back to sleep; a reopening socket arms this on session.updated
    if (conn.current && greeted.current) armSleep();
    else if (!conn.current) openSocket();
  }, [openSocket, armSleep, startRecord, failLive]);

  /**
   * What the wake-word recogniser heard, once per utterance and action (interim
   * results repeat). Everything needs his name: asleep, "Krishna, listen to me"
   * wakes him; awake, "Krishna, thank you / understood" sends him back to sleep,
   * and "Krishna" alone while he talks stops him and listens.
   */
  const heard = useCallback((text: string, done: Set<string>) => {
    if (!wakeMode.current || pausedRef.current || !WAKE_RE.test(text)) return;
    const once = (action: string, run: () => void) => {
      if (!done.has(action)) { done.add(action); run(); }
    };
    if (!awake.current) {
      if (CALL_RE.test(text)) once("wake", wake);
    } else if (DISMISS_RE.test(text)) {
      once("dismiss", () => {
        if (player.current?.isPlaying) interrupt();
        else conn.current?.send({ type: "response.cancel" }); // he may be about to answer the dismissal
        holdAwake();
        goToSleep();
      });
    } else if (player.current?.isPlaying) once("interrupt", interrupt);
  }, [wake, interrupt, holdAwake, goToSleep]);
  const heardRef = useRef<(text: string, done: Set<string>) => void>(() => {});
  useEffect(() => { heardRef.current = heard; }, [heard]);

  /** The recogniser failed for good: drop hands-free and listen all the time, greeting as before. */
  const alwaysListen = useCallback(() => {
    const r = recog.current;
    recog.current = null;
    r?.abort();
    wakeMode.current = false;
    awake.current = true;
    holdAwake();
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    // reopen without the hands-free note; session.updated greets once `ready` has resolved
    const c = conn.current;
    conn.current = null;
    c?.close();
    openSocket();
    if (!convoId.current) startRecord().catch(failLive);
    setMood("listening");
  }, [holdAwake, openSocket, startRecord, failLive]);

  const start = useCallback(async () => {
    setProblem(null);
    greeted.current = false;
    let resolve = () => {};
    ready.current = { promise: new Promise<void>((r) => (resolve = r)), resolve };
    setPhase("connecting");
    setMood("thinking");
    try {
      // AudioContext must be created inside the click (iOS needs a user gesture)
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtx.resume().catch(() => {}); // a headphone press isn't a click; the page's earlier click lets this through
      ctx.current = audioCtx;
      player.current = new PcmPlayer(audioCtx);

      // Hands-free (wake word) wherever the browser has a speech recogniser
      const Rec = recognizerClass();
      wakeMode.current = Boolean(Rec);
      awake.current = !Rec;
      roll.current = [];

      // Connect to fal first, so the token, socket and persona set up while the
      // quota check, mic prompt and worklet load run alongside (the token route
      // checks the quota too, so a used-up day still gets refused)
      openSocket();

      const [left, stream] = await Promise.all([
        refreshQuota(),
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        }),
        audioCtx.audioWorklet.addModule("/pcm-recorder.js"),
      ]);
      mic.current = stream;
      if (left != null && left <= 0) throw Object.assign(new Error("quota"), { name: "QuotaError" });

      // Record the session start (used for the daily quota), only once the mic is
      // granted; hands-free, each waking records instead
      if (!Rec) await startRecord(left);

      // Stream the mic up in 50 ms chunks
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      micAnalyser.current = analyser;
      const recorder = new AudioWorkletNode(audioCtx, "pcm-recorder");
      recorder.port.onmessage = (e: MessageEvent<Float32Array>) => {
        roll.current.push(e.data);
        const c = conn.current;
        if (awake.current && greeted.current && c) {
          for (const chunk of roll.current) c.send({ type: "input_audio_buffer.append", audio: floatToPcm16Base64(chunk) });
          roll.current = [];
        } else {
          // asleep: keep a short pre-roll; awake but (re)connecting: hold more
          const max = awake.current ? CONNECT_ROLL_CHUNKS : PRE_ROLL_CHUNKS;
          if (roll.current.length > max) roll.current.splice(0, roll.current.length - max);
        }
      };
      source.connect(recorder);

      if (Rec) {
        const r = new Rec();
        r.lang = "en-IN"; // catches "Krishna" in English, Hindi and Hinglish speech
        r.continuous = true;
        r.interimResults = true;
        let fired = new Map<number, Set<string>>(); // per utterance: actions already taken
        r.onresult = (ev) => {
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            if (!fired.has(i)) fired.set(i, new Set());
            heardRef.current(ev.results[i][0].transcript, fired.get(i)!);
          }
        };
        r.onerror = (ev) => {
          // e.g. blocked, offline, or Brave's missing speech service: never wakes, so listen always
          if (recog.current === r && FATAL_RECOGNITION.has(ev.error)) alwaysListen();
        };
        // Chrome ends continuous recognition every so often; keep it going (not while paused)
        r.onend = () => {
          fired = new Map();
          setTimeout(() => {
            if (recog.current === r && !pausedRef.current) try { r.start(); } catch {}
          }, 250);
        };
        recog.current = r;
        r.start();
        setMood("standby");
        scheduleClose();
      }
      ready.current?.resolve();
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
  }, [openSocket, scheduleClose, stop, refreshQuota, startRecord, alwaysListen]);

  useEffect(() => () => { stop(); }, [stop]);

  // ---- pause: freezing the AudioContext holds Krishna mid-word and mutes the mic;
  // the wake-word recogniser has its own mic, so it stops too
  const togglePause = useCallback(async () => {
    const c = ctx.current;
    if (!c) return;
    if (c.state === "running") {
      pausedRef.current = true;
      recog.current?.abort();
      holdAwake();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      await c.suspend();
      setPaused(true);
    } else {
      await c.resume();
      pausedRef.current = false;
      try { recog.current?.start(); } catch {}
      if (wakeMode.current) {
        if (awake.current) armSleep();
        else scheduleClose();
      }
      setPaused(false);
    }
  }, [holdAwake, armSleep, scheduleClose]);

  // ---- headphone / media key: first press begins, then pause / resume like a video
  const toggle = useRef(() => {});
  const stopRef = useRef(() => {});
  useEffect(() => {
    toggle.current = () => {
      if (phase === "idle") start();
      else if (phase === "live") togglePause();
    };
    stopRef.current = () => { if (phase === "live") stop(); };
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = phase === "live" && !paused ? "playing" : "paused";
    }
  }, [phase, paused, start, stop, togglePause]);
  useEffect(() => {
    const ms = "mediaSession" in navigator ? navigator.mediaSession : null;
    // Browsers route media keys only to a page playing an <audio> element (Chrome:
    // one at least 5 s long), so a silent loop starts on the first click or key
    const silence = new Audio("/silence.wav");
    silence.loop = true;
    const arm = () => { silence.play().catch(() => {}); };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "MediaPlayPause") { e.preventDefault(); toggle.current(); }
    };
    window.addEventListener("keydown", onKey);
    if (ms) {
      ms.metadata = new MediaMetadata({ title: "Talk to Krishna", artist: "Krishna" });
      for (const action of ["play", "pause"] as const) {
        try { ms.setActionHandler(action, () => toggle.current()); } catch {}
      }
      try { ms.setActionHandler("stop", () => stopRef.current()); } catch {}
    }
    return () => {
      silence.pause();
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("keydown", onKey);
      if (ms) for (const action of ["play", "pause", "stop"] as const) {
        try { ms.setActionHandler(action, null); } catch {}
      }
    };
  }, []);

  // Closing the tab mid-call: mark the conversation ended so its minutes stop counting
  useEffect(() => {
    const onHide = () => {
      if (convoId.current) navigator.sendBeacon("/api/convo", JSON.stringify({ action: "end", id: convoId.current }));
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // ---- render ----------------------------------------------------------------
  const live = phase !== "idle";
  const orbState: OrbState =
    phase === "connecting" ? "connect"
      : !live ? "idle"
        : ({ idle: "idle", standby: "idle", listening: "listen", thinking: "idle", remembering: "remember", speaking: "speak" } as const)[mood];
  const status =
    phase === "connecting" ? "Connecting…"
      : paused ? "Paused · press play on your headphones, or Resume"
        : STATUS[live ? mood : "idle"];
  const pauseButton = (sm: boolean) =>
    phase === "live" && (
      <button className={`pill pill--o ${sm ? "pill--sm" : ""}`} onClick={togglePause}>
        {paused ? "Resume" : "Pause"}
      </button>
    );
  const minutes = remaining != null && <span className="meta">{Math.max(0, Math.floor(remaining))} minutes left today</span>;
  const shown = items.filter((it) => it.kind === "card" || it.text || it.who === "you");
  const last = shown[shown.length - 1];

  return (
    <div ref={root} className={`convo ${live ? "convo--live" : ""}`}>
      <section className="presence" aria-label="Krishna">
        {problem && !live ? (
          <ProblemView problem={problem} onRetry={start} saving={saving} />
        ) : (
          <>
            <div className="presence__full">
              <h1 className="disp">Speak, and be heard.</h1>
              <Orb state={orbState} />
              <p className="status" aria-live="polite">{status}</p>
              <div className="presence__actions">
                {live ? (
                  <>
                    {pauseButton(false)}
                    <button className="pill pill--o" onClick={stop} disabled={phase === "connecting"}>End conversation</button>
                  </>
                ) : (
                  <button className="pill" onClick={start} onPointerEnter={prefetchToken} onFocus={prefetchToken}>
                    Begin conversation
                  </button>
                )}
                {minutes}
                {!saving && !live && <span className="meta">Conversations are not saved here</span>}
              </div>
            </div>
            <div className="presence__compact">
              <Orb state={orbState} />
              <div className="presence__compact-text">
                <p className="status" aria-live="polite">{status}</p>
                {minutes}
              </div>
              {pauseButton(true)}
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
                Press begin once and allow the microphone. Krishna stays silent until you say &ldquo;Hey Krishna&rdquo; or &ldquo;Krishna, listen to
                me&rdquo;, then talk freely in English, Hindi or Hinglish. When you are done, say &ldquo;Krishna, thank
                you&rdquo; or &ldquo;Krishna, understood&rdquo; and he goes quiet again. Say &ldquo;Krishna&rdquo; or
                &ldquo;stop&rdquo; to interrupt him.
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

function ProblemView({ problem, onRetry, saving }: { problem: Problem; onRetry: () => void; saving: boolean }) {
  if (problem.kind === "quota")
    return (
      <div className="presence__error">
        <Orb state="still" />
        <p className="kr" style={{ textAlign: "center" }}>You&apos;ve used today&apos;s minutes. Come back tomorrow.</p>
        <span className="meta">0 minutes left today</span>
        {saving && <Link className="lnk lnk--u" href="/history">Read your conversations</Link>}
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
