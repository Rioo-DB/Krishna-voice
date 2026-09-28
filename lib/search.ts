import { readFileSync } from "node:fs";
import { join } from "node:path";

// Built by scripts/build-corpus.mjs from the krishna-corpus folders
const CORPUS_PATH = join(process.cwd(), "data/corpus.json");

export type Collection = "gita" | "life" | "teachings";
export type Passage = {
  id: number;
  collection: Collection;
  source: string;
  text: string;
  context?: string;
  sanskrit?: string;
};

const STOP = new Set(
  ("a an and are as at be but by did do does for from had has have he her him his how i in into is it its " +
    "me my of on or our said she so than that the their them then there these they this thou thee thy to " +
    "unto upon us was we were what when where which who whom why will with ye you your yours tell story about")
    .split(" "),
);

/**
 * Normalises spellings so transliteration variants meet:
 * Kansa/Kamsa, Vrindavan/Vrindavana/Brindaban, Yashoda/Yasoda, Krishna's/Krsna.
 */
export function tokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) =>
      t
        .replace(/sh/g, "s")
        .replace(/ms(?=[aeiou])/g, "ns")
        .replace(/^b(?=r)/, "v")
        .replace(/w/g, "v")
        .replace(/(?<=[a-z]{3})(a|es|s)$/, "")
        .replace(/^kris(?=n)/, "krs"),
    );
}

type Index = { docs: Passage[]; tf: Map<string, number>[]; len: number[]; df: Map<string, number>; avg: number };
let index: Index | null = null;

function build(): Index {
  const docs = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as Passage[];
  const df = new Map<string, number>();
  const tf = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of tokens(`${d.source} ${d.context ?? ""} ${d.text}`)) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return m;
  });
  const len = tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  return { docs, tf, len, df, avg: len.reduce((a, b) => a + b, 0) / len.length };
}

/** BM25 over all passages, at most two passages per source so results stay varied. */
export function search(query: string, opts: { collection?: Collection; limit?: number } = {}): Passage[] {
  index ??= build();
  const { docs, tf, len, df, avg } = index;
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const N = docs.length, k1 = 1.2, b = 0.75;
  const scored: { i: number; s: number }[] = [];
  for (let i = 0; i < N; i++) {
    if (opts.collection && docs[i].collection !== opts.collection) continue;
    let s = 0;
    for (const t of q) {
      const f = tf[i].get(t);
      if (!f) continue;
      const n = df.get(t)!;
      s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len[i]) / avg)));
    }
    if (s > 0) scored.push({ i, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const perSource = new Map<string, number>();
  const out: Passage[] = [];
  for (const { i } of scored) {
    const d = docs[i];
    const n = perSource.get(d.source) ?? 0;
    if (n >= 2) continue;
    perSource.set(d.source, n + 1);
    out.push(d);
    if (out.length >= (opts.limit ?? 5)) break;
  }
  return out;
}
