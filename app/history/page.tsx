import Link from "next/link";
import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { session } from "@/lib/db";
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
  const s = await session();
  if (!s) redirect("/login");
  const { cleared } = await searchParams;

  // The signed-in user's conversations only (krishna_my_history scopes by auth.uid())
  const { data } = await s.supa.rpc("krishna_my_history", { p_limit: 50 });
  const convos = ((data ?? []) as Convo[]).filter((c) => c.messages.length);

  return (
    <main className="frame">
      <TopBar here="history" />

      {convos.length === 0 ? (
        <div className="empty">
          <span className="om" lang="sa" aria-hidden="true">ॐ</span>
          <p className="kr">{cleared ? "Your history has been cleared." : "No conversations yet."}</p>
          <p className="meta meta--lg">When you speak with Krishna, your conversations will rest here, with your account.</p>
          <Link className="pill pill--sm" href="/">Begin conversation</Link>
        </div>
      ) : (
        <div className="history">
          <h1 className="disp">Your conversations</h1>
          <p className="meta meta--lg" style={{ marginTop: -40, marginBottom: 40 }}>Saved with your account, on any device you sign in from.</p>
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
