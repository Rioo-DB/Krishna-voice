// Guardrail test: asks Krishna each question from tests/guardrail-questions.json in its own fresh
// Grok Voice session, as the app does (full persona + hands-free note, the same tools; scripture
// search is answered by the running app), and writes what he said to tests/results/<run>.jsonl.
//
//   npm run start   (in another terminal; the app must be running on :3456)
//   node --env-file=.env.local scripts/guardrail-test.mjs [--severity Critical] [--only 27,30] [--concurrency 4] [--out name]
//
// Needs FAL_KEY (in .env.local) and DEMO_LOGIN / DEMO_PASSWORD for an account on the app.
// Grading is done separately against each question's expected / mustNot fields.
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { fal } from "@fal-ai/client";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const severity = arg("severity");
const only = arg("only");
const concurrency = Number(arg("concurrency", "4"));
const outName = arg("out", new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"));
const APP = arg("app", "http://localhost:3456");

fal.config({ credentials: process.env.FAL_KEY });
const krishna = readFileSync("lib/krishna.ts", "utf8").match(/KRISHNA_PROMPT = `([\s\S]*?)`\.trim\(\)/)[1].trim();
const wake = readFileSync("components/KrishnaVoice.tsx", "utf8").match(/const WAKE_NOTE = `([\s\S]*?)`\.trim\(\)/)[1].trim();
const today = new Date().toLocaleDateString("en-IN", { dateStyle: "full", timeZone: "Asia/Kolkata" });
const prompt = [krishna, wake, `Today is ${today} (India time).`].join("\n\n");
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const TOOLS = [{
  type: "function", name: "search_scriptures",
  description: "Search Krishna's scriptures: the Bhagavad Gita (701 verses), the stories of his life (Vishnu Purana, Harivamsha, Bhagavata, Mahabharata) and his other teachings (Anugita, his Mahabharata speeches). Returns passages with their sources.",
  parameters: { type: "object", properties: {
    query: { type: "string", description: "Short English keywords, e.g. 'Govardhan hill Indra rain'" },
    collection: { type: "string", enum: ["gita", "life", "teachings"], description: "Optional: limit to the Gita, life stories, or other teachings" } },
    required: ["query"] },
}, { type: "web_search", location: { country: "IN" } }, { type: "x_search", from_date: weekAgo }];

// The app's /api/search needs a signed-in session
const signin = await fetch(`${APP}/auth/signin`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login: process.env.DEMO_LOGIN ?? "demo", password: process.env.DEMO_PASSWORD }) });
const cookie = (signin.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!signin.ok || !cookie) throw new Error(`sign-in to ${APP} failed (${signin.status}); set DEMO_PASSWORD`);

async function search(args) {
  const r = await fetch(`${APP}/api/search`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(args) });
  const data = await r.json();
  return { results: (data.results ?? []).slice(0, 3).map((p) => ({ source: p.source, text: p.text.slice(0, 600) })), note: data.note };
}

function ask(q) {
  return new Promise((resolve) => {
    let said = "", configured = false, pending = 0, finished = false;
    const tools = [];
    const end = (status) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { conn.close(); } catch {}
      resolve({ n: q.n, severity: q.severity, status, answer: said.trim(), tools });
    };
    const timer = setTimeout(() => end("timeout"), 75_000);
    const conn = fal.realtime.connect("xai/grok-voice/realtime", {
      throttleInterval: 0,
      tokenProvider: async (app) => {
        const r = await fetch("https://rest.fal.ai/tokens/", { method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Key ${process.env.FAL_KEY}` },
          body: JSON.stringify({ allowed_apps: [app.split("/")[1]], token_expiration: 120 }) });
        return r.json();
      },
      onResult: async (ev) => {
        if (ev.type === "session.updated" && !configured) {
          configured = true;
          conn.send({ type: "session.update", session: { tools: TOOLS } });
          conn.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: q.question }] } });
          conn.send({ type: "response.create" });
        }
        if (ev.type === "response.output_audio_transcript.delta") said += ev.delta ?? "";
        if (ev.type === "response.function_call_arguments.done" && ev.name === "search_scriptures") {
          pending++;
          tools.push(`search_scriptures(${ev.arguments})`);
          let output;
          try { output = await search(JSON.parse(ev.arguments || "{}")); } catch { output = { error: "Search failed. Answer without citing a source." }; }
          conn.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(output) } });
          conn.send({ type: "response.create" });
          pending--;
        }
        if (ev.type === "response.done" && pending === 0 && said.trim()) setTimeout(() => { if (pending === 0) end("ok"); }, 1500);
        if (ev.type === "error") tools.push("grok_error:" + JSON.stringify(ev.error ?? ev).slice(0, 160));
      },
      onError: (e) => end("socket_error:" + (e?.message ?? e)),
    });
    conn.send({ type: "x-fal-session.configure", prompt, voice: process.env.KRISHNA_VOICE ?? "orion",
      turn_detection: { silence_duration_ms: 600, prefix_padding_ms: 300 } });
  });
}

mkdirSync("tests/results", { recursive: true });
const out = `tests/results/${outName}.jsonl`;
const want = only ? new Set(only.split(",").map(Number)) : null;
const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === "ok").map((r) => r.n) : []);
const queue = JSON.parse(readFileSync("tests/guardrail-questions.json", "utf8"))
  .filter((q) => (!severity || q.severity === severity) && (!want || want.has(q.n)) && !done.has(q.n));
console.log(`persona ${(prompt.length / 1024).toFixed(1)} KB; asking ${queue.length} → ${out}`);

let i = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (i < queue.length) {
    const q = queue[i++];
    let r = await ask(q);
    if (r.status !== "ok") r = await ask(q); // one retry for a dropped session
    appendFileSync(out, JSON.stringify(r) + "\n");
    console.log(`#${r.n} ${r.status} ${r.answer.slice(0, 80).replace(/\s+/g, " ")}`);
  }
}));
process.exit(0);
