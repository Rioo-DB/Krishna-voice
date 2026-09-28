import Link from "next/link";
import KrishnaVoice from "@/components/KrishnaVoice";
import { dbConfigured } from "@/lib/device";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="frame frame--fixed">
      <nav className="topbar">
        <span className="wm">KRISHNA</span>
        {dbConfigured && (
          <Link className="lnk" href="/history">
            <span className="only-d">Your conversations</span>
            <span className="only-m">History</span>
          </Link>
        )}
      </nav>
      <KrishnaVoice voice={process.env.KRISHNA_VOICE ?? "orion"} saving={dbConfigured} />
    </main>
  );
}
