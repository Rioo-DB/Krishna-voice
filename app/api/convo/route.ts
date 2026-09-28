import { db, deviceId, isUuid, remainingMinutes } from "@/lib/db";

export const dynamic = "force-dynamic";

type Body =
  | { action: "start" }
  | { action: "end"; id: string }
  | { action: "message"; id: string; role: "user" | "krishna"; content: string }
  | { action: "delete-history" };

/** Saves this browser's conversation. Every call is scoped to its device cookie. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const supa = db();
  const device = await deviceId();
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  if (!supa || !device) return Response.json({ id: null }); // local dev without a database: nothing saved

  switch (body.action) {
    case "start": {
      const left = await remainingMinutes(device);
      if (left !== null && left <= 0) return Response.json({ error: "quota" }, { status: 429 });
      const { data, error } = await supa.rpc("krishna_start", { p_device: device });
      if (error) throw error;
      return Response.json({ id: data });
    }
    case "end":
      if (!isUuid(body.id)) break;
      await supa.rpc("krishna_end", { p_device: device, p_convo: body.id });
      return Response.json({ ok: true });
    case "message":
      if (!isUuid(body.id) || !["user", "krishna"].includes(body.role) || typeof body.content !== "string") break;
      await supa.rpc("krishna_add_message", {
        p_device: device,
        p_convo: body.id,
        p_role: body.role,
        p_content: body.content.slice(0, 4000),
      });
      return Response.json({ ok: true });
    case "delete-history":
      await supa.rpc("krishna_delete_history", { p_device: device });
      return Response.json({ ok: true });
  }
  return Response.json({ error: "Bad request" }, { status: 400 });
}
