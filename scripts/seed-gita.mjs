// Seeds the 701 Gita verses from the local krishna-corpus (../01-bhagavad-gita/json)
// and embeds each one through the search-gita Edge Function.
//   node --env-file=.env.local scripts/seed-gita.mjs
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SERVICE || !ANON) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local");
const supabase = createClient(URL, SERVICE);

const CORPUS = new globalThis.URL("../../01-bhagavad-gita/json/", import.meta.url);
const load = async (f) => JSON.parse(await readFile(new globalThis.URL(f, CORPUS), "utf8"));
const [verses, chapters] = await Promise.all([load("gita-verses.json"), load("gita-chapters.json")]);

// Public-domain translations only (see the corpus README): Purohit Swami, then Sivananda
const PREFERRED = ["Shri Purohit Swami", "Swami Sivananda"];
const clean = (s) => s.replace(/\s+/g, " ").trim();
const englishOf = (v) => {
  for (const author of PREFERRED) {
    const t = v.translations.find((t) => t.author === author && t.lang === "english");
    if (t?.text) return clean(t.text);
  }
  return "";
};
const chapterName = new Map(chapters.map((c) => [c.chapter_number, `${c.name_translation} (${c.name_meaning})`]));

async function embed(text, attempt = 1) {
  const r = await fetch(`${URL}/functions/v1/search-gita`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ query: text, mode: "embed" }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.embedding) return j.embedding;
  if (attempt < 4) {
    await new Promise((res) => setTimeout(res, 1500 * attempt));
    return embed(text, attempt + 1);
  }
  throw new Error(`embed failed: ${JSON.stringify(j)}`);
}

const rows = verses.map((v) => ({
  chapter: v.chapter,
  verse: v.verse,
  chapter_name: chapterName.get(v.chapter) ?? `Chapter ${v.chapter}`,
  sanskrit: v.sanskrit.replace(/।।[\d.]+।।/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" / "),
  transliteration: v.transliteration.trim().split(/\n+/).join(" / "),
  english: englishOf(v),
}));

// Embed 5 at a time to stay polite to the Edge Function
for (let i = 0; i < rows.length; i += 5) {
  const batch = rows.slice(i, i + 5);
  await Promise.all(
    batch.map(async (row) => {
      row.embedding = await embed(`${row.chapter_name}. ${row.english}`);
    }),
  );
  const { error } = await supabase.from("gita_verses").upsert(batch, { onConflict: "chapter,verse" });
  if (error) throw error;
  process.stdout.write(`\rseeded ${Math.min(i + 5, rows.length)} / ${rows.length}`);
}
console.log("\ndone");
