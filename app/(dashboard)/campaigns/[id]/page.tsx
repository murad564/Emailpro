"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventPieChart } from "@/components/dashboard/charts";
import {
  ArrowLeft, Send, Pencil,
  MousePointerClick, BarChart2, AlertTriangle,
  CheckCircle, XCircle, SkipForward, Loader2,
  Info, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { pct, formatNumber } from "@/lib/utils";

interface EmailEvent {
  id: string;
  type: string;
  email: string;
  createdAt: string;
  url: string | null;
}

interface Campaign {
  id: string;
  name: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  status: string;
  totalSent: number;
  totalDelivered: number;
  totalOpens: number;
  totalUniqueOpens: number;
  totalClicks: number;
  totalUniqueClicks: number;
  totalBounces: number;
  totalUnsubscribes: number;
  totalSkipped: number;
  totalErrors: number;
  sentAt: string | null;
  createdAt: string;
  segment: { name: string } | null;
  emailEvents: EmailEvent[];
}

const EVENT_COLORS: Record<string, string> = {
  opened:       "bg-green-100 text-green-700",
  clicked:      "bg-blue-100 text-blue-700",
  delivered:    "bg-emerald-100 text-emerald-700",
  bounced:      "bg-red-100 text-red-700",
  unsubscribed: "bg-orange-100 text-orange-700",
  complained:   "bg-purple-100 text-purple-700",
};

// Show "—" instead of "0%" for external stats that haven't been received yet.
// If totalSent > 0 but the metric is 0, it's almost certainly "not configured" not "real 0".
function extPct(num: number, den: number): string {
  if (den === 0) return "—";
  if (num === 0) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}
function extNum(num: number): string {
  if (num === 0) return "—";
  return formatNumber(num);
}

export default function CampaignDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [syncing, setSyncing]   = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch(`/api/campaigns/${params.id}`);
    if (!res.ok) { router.push("/campaigns"); return null; }
    const data: Campaign = await res.json();
    setCampaign(data);
    if (!silent) setLoading(false);
    return data;
  }, [params.id, router]);

  useEffect(() => {
    if (!campaign) return;
    if (campaign.status === "sending") {
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          const data = await load(true);
          if (data && data.status !== "sending") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
          }
        }, 2000);
      }
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [campaign?.status, load]);

  useEffect(() => { load(); }, [load]);

  async function handleSync() {
    if (!campaign) return;
    setSyncing(true);
    const res  = await fetch("/api/sync/brevo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: campaign.id }) });
    const data = await res.json();
    setSyncing(false);
    if (res.ok) {
      toast.success(`Synced ${data.imported} event${data.imported !== 1 ? "s" : ""} from Brevo`);
      load();
    } else {
      toast.error(data.error ?? "Sync failed");
    }
  }

  async function handleSend() {
    if (!campaign) return;
    if (!confirm(`Send "${campaign.name}" now?`)) return;
    setSending(true);
    const res  = await fetch(`/api/campaigns/${campaign.id}/send`, { method: "POST" });
    const data = await res.json();
    setSending(false);
    if (res.ok) {
      const note = data.skipped > 0 ? ` (${data.skipped} skipped — daily limit)` : "";
      toast.success(`Sending started${note} — stats update live below.`);
      load();
    } else {
      toast.error(data.error ?? "Send failed");
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full py-32 text-gray-400">Loading…</div>
  );
  if (!campaign) return null;

  const isSending  = campaign.status === "sending";
  const isSent     = campaign.status === "sent";
  const hasExtData = campaign.totalDelivered > 0 || campaign.totalOpens > 0 || campaign.totalClicks > 0 || campaign.totalBounces > 0;

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${APP_URL}/api/webhooks/brevo`;

  const events  = campaign.emailEvents;
  const pieData = (["delivered", "opened", "clicked", "bounced", "unsubscribed"] as const)
    .map((type) => ({ name: type, value: events.filter((e) => e.type === type).length }))
    .filter((d) => d.value > 0);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/campaigns">
            <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 mt-0.5">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
              <StatusBadge status={campaign.status} />
            </div>
            <p className="text-sm text-gray-500">{campaign.subject}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {campaign.status === "draft" && (
            <>
              <Link href={`/campaigns/${campaign.id}/edit`}>
                <Button variant="outline" size="sm"><Pencil className="w-4 h-4" />Edit</Button>
              </Link>
              <Button size="sm" onClick={handleSend} loading={sending}>
                <Send className="w-4 h-4" />Send now
              </Button>
            </>
          )}
          {campaign.status === "sent" && (
            <Button variant="outline" size="sm" onClick={handleSync} loading={syncing}>
              <RefreshCw className="w-4 h-4" />Sync from Brevo
            </Button>
          )}
        </div>
      </div>

      {/* Live sending progress banner */}
      {isSending && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            <span className="text-sm font-semibold text-blue-800">
              Sending — {campaign.totalSent.toLocaleString()} emails dispatched so far
              {campaign.totalErrors > 0 && `, ${campaign.totalErrors} failed`}
            </span>
          </div>
          <p className="text-xs text-blue-500">Stats refresh every 2 seconds automatically.</p>
        </div>
      )}

      {/* Tracking setup notice — shown after send when no webhook data received yet */}
      {isSent && campaign.totalSent > 0 && !hasExtData && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-sm font-semibold text-amber-800">
              Delivery &amp; engagement tracking not active
            </span>
          </div>
          <p className="text-xs text-amber-700">
            Delivered, open, click and bounce stats require two things to be set up:
          </p>
          <ol className="text-xs text-amber-700 space-y-1 list-decimal list-inside">
            <li>
              <span className="font-medium">Brevo webhook</span> — in your Brevo dashboard go to{" "}
              <span className="font-mono bg-amber-100 px-1 rounded">Transactional → Settings → Webhook</span>{" "}
              and add this URL for all event types:
              <span className="block font-mono bg-white border border-amber-200 rounded px-2 py-1 mt-1 text-amber-900 break-all select-all">
                {webhookUrl}
              </span>
            </li>
            <li>
              <span className="font-medium">Public app URL</span> — set{" "}
              <span className="font-mono bg-amber-100 px-1 rounded">NEXT_PUBLIC_APP_URL</span>{" "}
              in your <span className="font-mono bg-amber-100 px-1 rounded">.env.local</span>{" "}
              to your public server address so tracking pixels in emails can reach your app.
            </li>
          </ol>
          <p className="text-xs text-gray-500 pt-1">
            Sent / Failed / Skipped counts are always accurate — they are tracked internally.
          </p>
        </div>
      )}

      {/* Meta info */}
      <Card>
        <CardContent className="py-4">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">From</dt>
              <dd className="font-medium text-gray-900 mt-0.5">{campaign.fromName} &lt;{campaign.fromEmail}&gt;</dd>
            </div>
            <div>
              <dt className="text-gray-500">Segment</dt>
              <dd className="font-medium text-gray-900 mt-0.5">{campaign.segment?.name ?? "All contacts"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Created</dt>
              <dd className="font-medium text-gray-900 mt-0.5">{format(new Date(campaign.createdAt), "MMM d, yyyy")}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Sent at</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {campaign.sentAt ? format(new Date(campaign.sentAt), "MMM d, yyyy HH:mm") : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* ── Sending stats (always accurate — tracked internally) ── */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Sending — tracked internally
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Sent",
              value: formatNumber(campaign.totalSent),
              pctLine: campaign.totalSent > 0 ? "100% of target" : "—",
              icon: <Send className="w-5 h-5" />,
              color: "text-blue-600 bg-blue-50",
              note: isSending ? "updating live…" : null,
            },
            {
              label: "Failed",
              value: formatNumber(campaign.totalErrors),
              pctLine: campaign.totalSent > 0 ? pct(campaign.totalErrors, campaign.totalSent) : "—",
              icon: <XCircle className="w-5 h-5" />,
              color: campaign.totalErrors > 0 ? "text-red-600 bg-red-50" : "text-gray-400 bg-gray-100",
              note: null,
            },
            {
              label: "Skipped",
              value: formatNumber(campaign.totalSkipped),
              pctLine: campaign.totalSkipped > 0
                ? `${campaign.totalSkipped} over daily limit`
                : "none skipped",
              icon: <SkipForward className="w-5 h-5" />,
              color: campaign.totalSkipped > 0 ? "text-orange-500 bg-orange-50" : "text-gray-400 bg-gray-100",
              note: null,
            },
            {
              label: "Delivered",
              value: extNum(campaign.totalDelivered),
              pctLine: campaign.totalSent > 0 ? extPct(campaign.totalDelivered, campaign.totalSent) : "—",
              icon: <CheckCircle className="w-5 h-5" />,
              color: campaign.totalDelivered > 0 ? "text-emerald-600 bg-emerald-50" : "text-gray-400 bg-gray-100",
              note: campaign.totalDelivered === 0 ? "via Brevo webhook" : null,
            },
          ].map(({ label, value, pctLine, icon, color, note }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500 font-medium">{label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
                  <p className="mt-0.5 text-xs font-medium text-gray-500">{pctLine}</p>
                  {note && <p className="mt-0.5 text-xs text-gray-400 italic">{note}</p>}
                </div>
                <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Engagement stats (require Brevo webhook / tracking pixel) ── */}
      {(isSent || isSending) && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Engagement — via Brevo webhook &amp; tracking pixel
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Open rate",
                value: campaign.totalUniqueOpens > 0 ? pct(campaign.totalUniqueOpens, campaign.totalSent) : "—",
                sub1:  campaign.totalUniqueOpens > 0 ? `${formatNumber(campaign.totalUniqueOpens)} unique opens` : "awaiting data",
                sub2:  campaign.totalOpens > 0 ? `${formatNumber(campaign.totalOpens)} total opens` : null,
                icon:  <BarChart2 className="w-5 h-5" />,
                color: campaign.totalUniqueOpens > 0 ? "text-brand-600 bg-brand-50" : "text-gray-400 bg-gray-100",
              },
              {
                label: "Click rate",
                value: campaign.totalUniqueClicks > 0 ? pct(campaign.totalUniqueClicks, campaign.totalSent) : "—",
                sub1:  campaign.totalUniqueClicks > 0 ? `${formatNumber(campaign.totalUniqueClicks)} unique clicks` : "awaiting data",
                sub2:  campaign.totalClicks > 0 ? `${formatNumber(campaign.totalClicks)} total clicks` : null,
                icon:  <MousePointerClick className="w-5 h-5" />,
                color: campaign.totalUniqueClicks > 0 ? "text-yellow-600 bg-yellow-50" : "text-gray-400 bg-gray-100",
              },
              {
                label: "Bounced",
                value: extNum(campaign.totalBounces),
                sub1:  campaign.totalBounces > 0 ? pct(campaign.totalBounces, campaign.totalSent) + " bounce rate" : "awaiting data",
                sub2:  null,
                icon:  <AlertTriangle className="w-5 h-5" />,
                color: campaign.totalBounces > 0 ? "text-red-600 bg-red-50" : "text-gray-400 bg-gray-100",
              },
              {
                label: "Unsubscribed",
                value: extNum(campaign.totalUnsubscribes),
                sub1:  campaign.totalUnsubscribes > 0 ? pct(campaign.totalUnsubscribes, campaign.totalSent) + " unsub rate" : "awaiting data",
                sub2:  null,
                icon:  <XCircle className="w-5 h-5" />,
                color: campaign.totalUnsubscribes > 0 ? "text-orange-600 bg-orange-50" : "text-gray-400 bg-gray-100",
              },
            ].map(({ label, value, sub1, sub2, icon, color }) => (
              <div key={label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500 font-medium">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{sub1}</p>
                    {sub2 && <p className="text-xs text-gray-400">{sub2}</p>}
                  </div>
                  <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All counters + chart */}
      {campaign.totalSent > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Event distribution</CardTitle></CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <EventPieChart data={pieData} />
              ) : (
                <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">
                  No engagement events yet
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>All counters</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3">
                {[
                  { label: "Sent",           value: campaign.totalSent,          pct: "100%",                                              color: "bg-blue-500" },
                  { label: "Delivered",      value: campaign.totalDelivered,      pct: extPct(campaign.totalDelivered, campaign.totalSent),  color: "bg-emerald-500" },
                  { label: "Opens",          value: campaign.totalOpens,          pct: extPct(campaign.totalOpens, campaign.totalSent),      color: "bg-green-500" },
                  { label: "Unique opens",   value: campaign.totalUniqueOpens,    pct: extPct(campaign.totalUniqueOpens, campaign.totalSent),color: "bg-teal-500" },
                  { label: "Clicks",         value: campaign.totalClicks,         pct: extPct(campaign.totalClicks, campaign.totalSent),     color: "bg-yellow-500" },
                  { label: "Unique clicks",  value: campaign.totalUniqueClicks,   pct: extPct(campaign.totalUniqueClicks, campaign.totalSent),color:"bg-amber-500" },
                  { label: "Bounced",        value: campaign.totalBounces,        pct: extPct(campaign.totalBounces, campaign.totalSent),    color: "bg-red-500" },
                  { label: "Unsubscribed",   value: campaign.totalUnsubscribes,   pct: extPct(campaign.totalUnsubscribes, campaign.totalSent),color:"bg-orange-400" },
                  { label: "Failed",         value: campaign.totalErrors,         pct: pct(campaign.totalErrors, campaign.totalSent),        color: "bg-red-800" },
                  { label: "Skipped",        value: campaign.totalSkipped,        pct: campaign.totalSkipped > 0 ? pct(campaign.totalSkipped, campaign.totalSent + campaign.totalSkipped) : "0%", color: "bg-gray-400" },
                ].map(({ label, value, pct: p, color }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${color}`} />
                      <span className="text-gray-600">{label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <span className="text-xs text-gray-400">{p}</span>
                      <span className="font-medium text-gray-900 w-12 text-right">{value.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent events */}
      {events.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent events</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium text-gray-500">Event</th>
                  <th className="px-5 py-2.5 text-left font-medium text-gray-500">Email</th>
                  <th className="px-5 py-2.5 text-left font-medium text-gray-500">URL</th>
                  <th className="px-5 py-2.5 text-left font-medium text-gray-500">Time</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 50).map((e) => (
                  <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${EVENT_COLORS[e.type] ?? "bg-gray-100 text-gray-600"}`}>
                        {e.type}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-gray-700">{e.email}</td>
                    <td className="px-5 py-2.5 text-gray-400 max-w-[200px] truncate">{e.url ?? "—"}</td>
                    <td className="px-5 py-2.5 text-gray-400">{format(new Date(e.createdAt), "MMM d, HH:mm")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
