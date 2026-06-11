"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

export function SyncBrevoButton() {
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();

  async function handleSync() {
    setSyncing(true);
    const res  = await fetch("/api/sync/brevo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    setSyncing(false);
    if (res.ok) {
      toast.success(`Synced ${data.imported} event${data.imported !== 1 ? "s" : ""} across ${data.campaigns} campaign${data.campaigns !== 1 ? "s" : ""}`);
      router.refresh();
    } else {
      toast.error(data.error ?? "Sync failed");
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} loading={syncing}>
      <RefreshCw className="w-4 h-4" />Sync from Brevo
    </Button>
  );
}
