"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Confirm replaces the link in place, no modal. Focus moves to "Keep them", the safe choice. */
export default function DeleteHistory({ count }: { count: number }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);

  async function remove() {
    setBusy(true);
    await fetch("/api/convo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-history" }),
    });
    router.replace("/history?cleared=1");
    router.refresh();
  }

  if (!confirming)
    return (
      <button className="lnk lnk--u" style={{ marginTop: 48, alignSelf: "flex-start" }} onClick={() => setConfirming(true)}>
        Delete my history
      </button>
    );

  return (
    <div className="confirm" role="group" aria-label="Delete history">
      <p className="srf">
        Delete all {count} conversation{count === 1 ? "" : "s"}? This can&apos;t be undone.
      </p>
      <div className="confirm__actions">
        <button className="pill pill--sm" onClick={remove} disabled={busy}>
          {busy ? "Deleting…" : "Delete history"}
        </button>
        <button ref={keep} className="lnk lnk--u" onClick={() => setConfirming(false)}>Keep them</button>
      </div>
    </div>
  );
}
