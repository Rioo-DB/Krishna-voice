import { search, type Collection } from "@/lib/search";

export const runtime = "nodejs";

const COLLECTIONS = new Set<Collection>(["gita", "life", "teachings"]);

// Answers Grok's search_scriptures function calls, relayed by the browser.
// Logged-in users only (proxy.ts), except in local try mode.
export async function POST(req: Request) {
  const { query, collection } = (await req.json().catch(() => ({}))) as { query?: string; collection?: string };
  if (!query || typeof query !== "string" || query.length > 300) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }
  const results = search(query, {
    collection: COLLECTIONS.has(collection as Collection) ? (collection as Collection) : undefined,
    limit: 5,
  });
  return Response.json({
    results: results.map(({ source, text, context, sanskrit }) => ({ source, context, text, sanskrit })),
    note: results.length
      ? "Draw only on these passages for specific facts, names and verse numbers."
      : "Nothing found. Do not cite a source or verse number.",
  });
}
