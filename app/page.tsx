import Link from "next/link";
import KrishnaVoice from "@/components/KrishnaVoice";
import { TRY_MODE } from "@/lib/mode";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="frame frame--fixed">
      <nav className="topbar">
        <span className="wm">KRISHNA</span>
        {!TRY_MODE && (
          <Link className="lnk" href="/history">
            <span className="only-d">Your conversations</span>
            <span className="only-m">History</span>
          </Link>
        )}
      </nav>
      <KrishnaVoice voice={process.env.KRISHNA_VOICE ?? "orion"} />
    </main>
  );
}
