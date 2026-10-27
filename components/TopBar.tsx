import Link from "next/link";
import { dbConfigured } from "@/lib/config";

type Here = "talk" | "dashboard" | "history";

/** Site navigation; with no database (local try mode) there are no accounts, so only the wordmark. */
export default function TopBar({ here }: { here: Here }) {
  const link = (to: Here, href: string, label: string, short: string) =>
    here !== to && (
      <Link className="lnk" href={href}>
        <span className="only-d">{label}</span>
        <span className="only-m">{short}</span>
      </Link>
    );
  return (
    <nav className="topbar">
      <Link className="wm" href="/">KRISHNA</Link>
      {dbConfigured && (
        <span className="topbar__links">
          {link("talk", "/", "Talk to Krishna", "Talk")}
          {link("dashboard", "/dashboard", "Dashboard", "Dashboard")}
          {link("history", "/history", "Your conversations", "History")}
          <form action="/auth/signout" method="post">
            <button className="lnk">Sign out</button>
          </form>
        </span>
      )}
    </nav>
  );
}
