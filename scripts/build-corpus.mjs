// Builds data/corpus.json: searchable English passages from the krishna-corpus folders.
//   node scripts/build-corpus.mjs
// Sanskrit-only texts (Bhagavata Canto 10, Uddhava Gita) are skipped: search runs on English.
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname; // krishna-corpus/
const OUT = new URL("../data/corpus.json", import.meta.url).pathname;
const MAX = 1100; // characters per passage

const COLLECTIONS = [
  { dir: "02-life-stories/vishnu-purana-book5", collection: "life", work: "Vishnu Purana, Book V (tr. Wilson, 1840)" },
  { dir: "02-life-stories/harivamsha-dutt", collection: "life", work: "Harivamsha (tr. Dutt, 1897)" },
  { dir: "02-life-stories/mahabharata-ganguli", collection: "life", work: "Mahabharata (tr. Ganguli)" },
  { dir: "02-life-stories/bhagavata-purana-canto10-sinha-1901", collection: "life", work: "Bhagavata Purana, Canto 10 (retold by Sinha, 1901)" },
  { dir: "03-other-teachings/anugita", collection: "teachings", work: "Anugita, Mahabharata (tr. Ganguli)" },
  { dir: "03-other-teachings/mahabharata-speeches", collection: "teachings", work: "Krishna's speeches, Mahabharata (tr. Ganguli)" },
];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

const devanagari = (s) => (s.match(/[ऀ-ॿ]/g) ?? []).length / Math.max(1, s.length);

/** Split prose into ~MAX-char passages on paragraph, then sentence, boundaries. */
function chunk(text) {
  const pieces = [];
  for (const para of text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (para.length <= MAX) pieces.push(para);
    else {
      let cur = "";
      for (const s of para.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [para]) {
        if (cur && cur.length + s.length > MAX) { pieces.push(cur.trim()); cur = ""; }
        cur += s;
      }
      if (cur.trim()) pieces.push(cur.trim());
    }
  }
  const passages = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + p.length > MAX) { passages.push(cur); cur = ""; }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) passages.push(cur);
  return passages.filter((p) => p.length > 80);
}

const docs = [];

// 1. Bhagavad Gita: one passage per verse (public-domain translations only)
const gitaDir = join(ROOT, "01-bhagavad-gita/json");
const verses = JSON.parse(await readFile(join(gitaDir, "gita-verses.json"), "utf8"));
const chapters = JSON.parse(await readFile(join(gitaDir, "gita-chapters.json"), "utf8"));
const chapterName = new Map(chapters.map((c) => [c.chapter_number, c.name_meaning]));
for (const v of verses) {
  const tr = (author) => v.translations.find((t) => t.author === author && t.lang === "english")?.text?.replace(/\s+/g, " ").trim();
  const english = tr("Shri Purohit Swami") ?? tr("Swami Sivananda");
  if (!english) continue;
  docs.push({
    collection: "gita",
    source: `Bhagavad Gita ${v.chapter}.${v.verse} (${chapterName.get(v.chapter)})`,
    text: english,
    sanskrit: v.sanskrit.replace(/।।[\d.]+।।/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" / "),
  });
}
for (const c of chapters) {
  docs.push({
    collection: "gita",
    source: `Bhagavad Gita, chapter ${c.chapter_number} summary (${c.name_meaning})`,
    text: c.chapter_summary.replace(/\s+/g, " ").trim(),
  });
}

// 2 & 3. Life stories and other teachings
for (const { dir, collection, work } of COLLECTIONS) {
  for (const file of await walk(join(ROOT, dir))) {
    const raw = await readFile(file, "utf8");
    if (devanagari(raw) > 0.2) continue;
    const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
    const context = raw.match(/^\*Context:\s*(.+?)\*$/m)?.[1]?.trim();
    const body = raw
      .replace(/^#.*$/gm, "") // headings
      .replace(/^\*[^*\n]+\*$/gm, "") // italic metadata lines (Source:, Context:, Sub-parva:)
      .split(/\n## (Translator's )?[Ff]ootnotes/)[0]
      .replace(/\[\d+\]/g, ""); // footnote markers
    for (const text of chunk(body)) {
      docs.push({ collection, source: `${work}: ${title.replace(/\s*\(.*?\)\s*$/, "")}`, context, text });
    }
  }
}

await mkdir(new URL("../data/", import.meta.url).pathname, { recursive: true });
await writeFile(OUT, JSON.stringify(docs.map((d, id) => ({ id, ...d }))));
const count = (c) => docs.filter((d) => d.collection === c).length;
console.log(`wrote ${docs.length} passages: gita ${count("gita")}, life ${count("life")}, teachings ${count("teachings")}`);
