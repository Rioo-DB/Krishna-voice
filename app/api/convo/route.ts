import { isUuid, session, usage } from "@/lib/db";

export const dynamic = "force-dynamic";

type Body =
  | { action: "start" }
  | { action: "end"; id: string }
  | { action: "message"; id: string; role: "user" | "krishna"; content: string }
  | { action: "delete-history" };

/** Saves the signed-in user's conversation. Every call is scoped to them by auth.uid(). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  const s = await session();
  if (!s) return Response.json({ id: null }); // local dev without a database: nothing saved
  const { supa } = s;

  switch (body.action) {
    case "start": {
      if ((await usage(supa)).remaining <= 0) return Response.json({ error: "quota" }, { status: 429 });
      const { data, error } = await supa.rpc("krishna_my_start");
      if (error) throw error;
      return Response.json({ id: data });
    }
    case "end":
      if (!isUuid(body.id)) break;
      await supa.rpc("krishna_my_end", { p_convo: body.id });
      return Response.json({ ok: true });
    case "message":
      if (!isUuid(body.id) || !["user", "krishna"].includes(body.role) || typeof body.content !== "string") break;
      await supa.rpc("krishna_my_add_message", {
        p_convo: body.id,
        p_role: body.role,
        p_content: body.content.slice(0, 4000),
      });
      return Response.json({ ok: true });
    case "delete-history":
      await supa.rpc("krishna_my_delete_history");
      return Response.json({ ok: true });
  }
  return Response.json({ error: "Bad request" }, { status: 400 });
}
