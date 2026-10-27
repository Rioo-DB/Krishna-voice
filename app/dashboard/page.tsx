import Link from "next/link";
import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { displayName } from "@/lib/config";
import { session, usage } from "@/lib/db";

export const dynamic = "force-dynamic";

type Convo = {
  id: string;
  started_at: string;
  ended_at: string | null;
  messages: { role: "user" | "krishna"; content: string; created_at: string }[];
};

const IST = "Asia/Kolkata";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const mins = (n: number) => `${Math.floor(n)} min`;

/** Each person's own dashboard: their minutes, recent conversations and account. */
export default async function Dashboard() {
  const s = await session();
  if (!s) redirect("/login");
  const { supa, user } = s;
  const name = displayName(user.email);

  const [u, { data }] = await Promise.all([
    usage(supa).catch(() => null),
    supa.rpc("krishna_my_history", { p_limit: 200 }),
  ]);
  const convos = ((data ?? []) as Convo[]).filter((c) => c.messages.length);
  const recent = convos.slice(0, 5);
  const since = new Date(user.created_at).toLocaleDateString("en-IN", { timeZone: IST, month: "long", year: "numeric" });

  return (
    <main className="frame">
      <TopBar here="dashboard" />
      <div className="history">
        <h1 className="disp">Namaste.</h1>
        <p className="meta meta--lg" style={{ marginTop: -40, marginBottom: 40 }}>{name}</p>

        <div className="stats">
          <div className="stat">
            <span className="sc">Today</span>
            <span className="stat__n">{u ? mins(u.today) : "—"}</span>
            <span className="meta">{u ? `${Math.floor(u.remaining)} min left today` : "Couldn't load minutes"}</span>
          </div>
          <div className="stat">
            <span className="sc">This month</span>
            <span className="stat__n">{u ? mins(u.month) : "—"}</span>
            <span className="meta">of conversation</span>
          </div>
          <div className="stat">
            <span className="sc">Conversations</span>
            <span className="stat__n">{convos.length}</span>
            <span className="meta">since {since}</span>
          </div>
        </div>

        <Link className="pill" href="/" style={{ alignSelf: "flex-start", marginTop: 40 }}>Talk to Krishna</Link>

        <h2 className="sc" style={{ marginTop: 64, marginBottom: 16 }}>Recent conversations</h2>
        <hr className="hr" />
        {recent.length === 0 ? (
          <p className="meta meta--lg" style={{ padding: "24px 0" }}>
            No conversations yet. Press Talk to Krishna, then say &ldquo;Hey Krishna&rdquo;.
          </p>
        ) : (
          recent.map((c) => (
            <div key={c.id}>
              <Link className="recent" href="/history">
                <span className="sc">{when(c.started_at)}</span>
                <span className="session__first">
                  {c.messages.find((m) => m.role === "user")?.content ?? c.messages[0].content}
                </span>
              </Link>
              <hr className="hr" />
            </div>
          ))
        )}
        {convos.length > recent.length && (
          <Link className="lnk lnk--u" href="/history" style={{ marginTop: 24, alignSelf: "flex-start" }}>
            See all {convos.length} conversations
          </Link>
        )}

        <h2 className="sc" style={{ marginTop: 64, marginBottom: 16 }}>Account</h2>
        <hr className="hr" />
        <div className="recent">
          <span className="meta meta--lg">Signed in as {name}</span>
          <span style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Link className="lnk lnk--u" href="/reset">Change password</Link>
            <form action="/auth/signout" method="post">
              <button className="lnk lnk--u">Sign out</button>
            </form>
          </span>
        </div>
      </div>
    </main>
  );
}
