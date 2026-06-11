"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Plus, Send, Trash2, Eye, BarChart2 } from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { pct } from "@/lib/utils";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: string;
  totalSent: number;
  totalOpens: number;
  totalClicks: number;
  totalBounces: number;
  sentAt: string | null;
  createdAt: string;
  segment: { name: string } | null;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch("/api/campaigns");
    const data = await res.json();
    const list: Campaign[] = Array.isArray(data) ? data : [];
    setCampaigns(list);
    if (!silent) setLoading(false);
    return list;
  }, []);

  // Poll every 3 s while any campaign is in "sending" state
  useEffect(() => {
    function startPolling() {
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        const list = await load(true);
        const stillSending = list.some((c) => c.status === "sending");
        if (!stillSending) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      }, 3000);
    }

    const hasSending = campaigns.some((c) => c.status === "sending");
    if (hasSending) {
      startPolling();
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [campaigns, load]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendCampaign(id: string, name: string) {
    if (!confirm(`Send "${name}" now? This will email all eligible contacts.`))
      return;
    setSending(id);
    const res = await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      const note = data.skipped > 0 ? ` (${data.skipped} skipped — daily limit)` : "";
      toast.success(`Sending started${note} — page will update automatically.`);
      load();
    } else {
      toast.error(data.error ?? "Send failed");
    }
    setSending(null);
  }

  async function deleteCampaign(id: string) {
    if (!confirm("Delete this campaign?")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    toast.success("Campaign deleted");
    load();
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link href="/campaigns/new">
          <Button size="sm">
            <Plus className="w-4 h-4" />
            New campaign
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-20">
          <Send className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No campaigns yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Create your first campaign to start sending emails
          </p>
          <Link href="/campaigns/new">
            <Button className="mt-4" size="sm">
              Create campaign
            </Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Campaign</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Sent</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Open rate</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Click rate</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Date</th>
                <th className="w-32 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-5 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">
                        {c.subject}
                      </p>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {c.totalSent.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {c.totalSent > 0 ? pct(c.totalOpens, c.totalSent) : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {c.totalSent > 0 ? pct(c.totalClicks, c.totalSent) : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-400">
                    {c.sentAt
                      ? format(new Date(c.sentAt), "MMM d, yyyy")
                      : format(new Date(c.createdAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      <Link href={`/campaigns/${c.id}`}>
                        <button className="p-1.5 text-gray-400 hover:text-brand-600 rounded" title="View">
                          <Eye className="w-4 h-4" />
                        </button>
                      </Link>
                      {c.status === "draft" && (
                        <button
                          onClick={() => sendCampaign(c.id, c.name)}
                          disabled={sending === c.id}
                          className="p-1.5 text-gray-400 hover:text-green-600 rounded disabled:opacity-50"
                          title="Send now"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteCampaign(c.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
