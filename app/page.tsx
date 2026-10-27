import KrishnaVoice from "@/components/KrishnaVoice";
import TopBar from "@/components/TopBar";
import { dbConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="frame frame--fixed">
      <TopBar here="talk" />
      <KrishnaVoice voice={process.env.KRISHNA_VOICE ?? "orion"} saving={dbConfigured} />
    </main>
  );
}
