import Link from "next/link";
import { redirect } from "next/navigation";
import { db, deviceId } from "@/lib/db";
import DeleteHistory from "./DeleteHistory";

export const dynamic = "force-dynamic";

type Convo = {
  id: string;
  started_at: string;
  ended_at: string | null;
  messages: { role: "user" | "krishna"; content: string; created_at: string }[];
};

const IST = "Asia/Kolkata";
const day = (iso: string, long: boolean) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: IST,
    ...(long ? { weekday: "long" } : {}),
    day: "numeric",
    month: "long",
  }).replace(",", " ·");
const minutes = (c: Convo) => {
  const end = c.ended_at ?? c.messages.at(-1)?.created_at;
  return end ? Math.max(1, Math.round((+new Date(end) - +new Date(c.started_at)) / 60_000)) : null;
};

export default async function History({ searchParams }: PageProps<"/history">) {
  const supa = db();
  if (!supa) redirect("/"); // no database (local dev): nothing is saved
  const { cleared } = await searchParams;

  // This browser's conversations only (scoped by its device cookie; there is no login)
  const device = await deviceId();
  const { data } = device ? await supa.rpc("krishna_history", { p_device: device }) : { data: [] };
  const convos = ((data ?? []) as Convo[]).filter((c) => c.messages.length);

  return (
    <main className="frame">
      <nav className="topbar">
        <Link className="wm" href="/">KRISHNA</Link>
        <Link className="lnk" href="/">
          <span className="only-d">Begin conversation</span>
          <span className="only-m">Begin</span>
        </Link>
      </nav>

      {convos.length === 0 ? (
        <div className="empty">
          <span className="om" lang="sa" aria-hidden="true">ॐ</span>
          <p className="kr">{cleared ? "Your history has been cleared." : "No conversations yet."}</p>
          <p className="meta meta--lg">When you speak with Krishna, your conversations will rest here, in this browser.</p>
          <Link className="pill pill--sm" href="/">Begin conversation</Link>
        </div>
      ) : (
        <div className="history">
          <h1 className="disp">Your conversations</h1>
          <p className="meta meta--lg" style={{ marginTop: -40, marginBottom: 40 }}>Saved in this browser only.</p>
          <hr className="hr" />
          {convos.map((c, n) => {
            const mins = minutes(c);
            const first = c.messages.find((m) => m.role === "user")?.content ?? c.messages[0].content;
            return (
              <div key={c.id}>
                <details className="session" open={n === 0}>
                  <summary>
                    <span className="session__head">
                      <span className="sc">
                        <span className="only-d">{day(c.started_at, true)}</span>
                        <span className="only-m">{day(c.started_at, false)}</span>
                        {mins && ` · ${mins} min`}
                      </span>
                      <span className="lnk" aria-hidden="true" />
                    </span>
                    <span className="session__first">{first}</span>
                  </summary>
                  <div className="session__body">
                    {c.messages.map((m, i) => (
                      <p key={i} className={m.role === "user" ? "me" : "kr"}>{m.content}</p>
                    ))}
                  </div>
                </details>
                <hr className="hr" />
              </div>
            );
          })}
          <DeleteHistory count={convos.length} />
        </div>
      )}
    </main>
  );
}
