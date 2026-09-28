import { createClient } from "jsr:@supabase/supabase-js@2";

// Built into Supabase Edge Runtime; no API key needed.
const model = new Supabase.ai.Session("gte-small");

Deno.serve(async (req) => {
  try {
    const { query, count = 4, mode } = await req.json();
    if (!query || typeof query !== "string") {
      return Response.json({ error: "query is required" }, { status: 400 });
    }

    const embedding = await model.run(query.slice(0, 500), { mean_pool: true, normalize: true });

    // mode "embed" is used only by the seed script
    if (mode === "embed") return Response.json({ embedding });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data, error } = await supabase.rpc("match_verses", {
      query_embedding: embedding,
      match_count: Math.min(Number(count) || 4, 8),
    });
    if (error) throw error;
    return Response.json({ results: data });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
