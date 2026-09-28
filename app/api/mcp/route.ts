import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// Called by xAI's servers during a conversation (not by the browser).
// Serves only public, read-only scripture, so it is left open; rate-limit it
// with a Vercel Firewall rule.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const maxDuration = 30;

async function searchGita(query: string) {
  const r = await fetch(`${SB_URL}/functions/v1/search-gita`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, count: 4 }),
  });
  return r.json();
}

async function getVerse(chapter: number, verse: number) {
  const url =
    `${SB_URL}/rest/v1/gita_verses?select=chapter,verse,chapter_name,sanskrit,transliteration,english` +
    `&chapter=eq.${chapter}&verse=eq.${verse}`;
  const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  const rows = await r.json();
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_gita",
      {
        title: "Search the Bhagavad Gita",
        description:
          "Search all 701 Bhagavad Gita verses by meaning. Use English keywords. Returns Sanskrit, transliteration and English.",
        inputSchema: z.object({ query: z.string().min(2).max(300) }),
      },
      async ({ query }) => {
        const data = await searchGita(query);
        const note = data?.results?.length
          ? "Quote only from these verses."
          : "No match. Do not cite a verse number.";
        return { content: [{ type: "text", text: JSON.stringify({ ...data, note }) }] };
      },
    );

    server.registerTool(
      "get_verse",
      {
        title: "Get one Gita verse",
        description: "Fetch one exact Bhagavad Gita verse by chapter (1-18) and verse number.",
        inputSchema: z.object({
          chapter: z.number().int().min(1).max(18),
          verse: z.number().int().min(1).max(78),
        }),
      },
      async ({ chapter, verse }) => {
        const v = await getVerse(chapter, verse);
        const text = v ? JSON.stringify(v) : JSON.stringify({ error: "No such verse. Do not cite it." });
        return { content: [{ type: "text", text }] };
      },
    );
  },
  { serverInfo: { name: "gita", version: "1.0.0" } },
);

export { handler as GET, handler as POST, handler as DELETE };
