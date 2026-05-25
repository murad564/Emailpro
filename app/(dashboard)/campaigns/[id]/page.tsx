"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SendsLineChart, EventPieChart } from "@/components/dashboard/charts";
import {
  ArrowLeft,
  Send,
  Pencil,
  MousePointerClick,
  BarChart2,
  Users,
  AlertTriangle,
  CheckCircle,
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
  sentAt: string | null;
  createdAt: string;
  segment: { name: string } | null;
  emailEvents: EmailEvent[];
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${params.id}`);
    if (!res.ok) {
      router.push("/campaigns");
      return;
    }
    const data = await res.json();
    setCampaign(data);
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend() {
    if (!campaign) return;
    if (!confirm(`Send "${campaign.name}" now?`)) return;
    setSending(true);
    const res = await fetch(`/api/campaigns/${campaign.id}/send`, {
      method: "POST",
    });
    const data = await res.json();
    setSending(false);
    if (res.ok) {
      toast.success(`Sent to ${data.totalSent} contacts!`);
      load();
    } else {
      toast.error(data.error ?? "Send failed");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-32 text-gray-400">
        Loading…
      </div>
    );
  }

  if (!campaign) return null;

  const events = campaign.emailEvents;
  const typeCounts: Record<string, number> = {};
  events.forEach((e) => {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  });

  const pieData = Object.entries(typeCounts)
    .filter(([k]) => ["sent", "opened", "clicked", "delivered", "bounced"].includes(k))
    .map(([name, value]) => ({ name, value }));

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
              <h1 className="text-2xl font-bold text-gray-900">
                {campaign.name}
              </h1>
              <StatusBadge status={campaign.status} />
            </div>
            <p className="text-sm text-gray-500">{campaign.subject}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {campaign.status === "draft" && (
            <>
              <Link href={`/campaigns/${campaign.id}/edit`}>
                <Button variant="outline" size="sm">
                  <Pencil className="w-4 h-4" />
                  Edit
                </Button>
              </Link>
              <Button size="sm" onClick={handleSend} loading={sending}>
                <Send className="w-4 h-4" />
                Send now
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Meta info */}
      <Card>
        <CardContent className="py-4">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">From</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {campaign.fromName} &lt;{campaign.fromEmail}&gt;
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Segment</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {campaign.segment?.name ?? "All contacts"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Created</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {format(new Date(campaign.createdAt), "MMM d, yyyy")}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Sent</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {campaign.sentAt
                  ? format(new Date(campaign.sentAt), "MMM d, yyyy HH:mm")
                  : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Delivered",
            value: formatNumber(campaign.totalDelivered),
            icon: <CheckCircle className="w-5 h-5" />,
            sub: `of ${formatNumber(campaign.totalSent)} sent`,
          },
          {
            label: "Open rate",
            value: pct(campaign.totalUniqueOpens, campaign.totalSent),
            icon: <BarChart2 className="w-5 h-5" />,
            sub: `${campaign.totalUniqueOpens} unique opens`,
          },
          {
            label: "Click rate",
            value: pct(campaign.totalUniqueClicks, campaign.totalSent),
            icon: <MousePointerClick className="w-5 h-5" />,
            sub: `${campaign.totalUniqueClicks} unique clicks`,
          },
          {
            label: "Bounced",
            value: formatNumber(campaign.totalBounces),
            icon: <AlertTriangle className="w-5 h-5" />,
            sub: `${campaign.totalUnsubscribes} unsubscribed`,
          },
        ].map(({ label, value, icon, sub }) => (
          <div
            key={label}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 font-medium">{label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
                <p className="mt-0.5 text-xs text-gray-400">{sub}</p>
              </div>
              <div className="p-2 bg-brand-50 rounded-lg text-brand-600">
                {icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {campaign.totalSent > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Activity timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length > 0 ? (
                <EventPieChart data={pieData} />
              ) : (
                <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">
                  No events recorded yet
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Event breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                {[
                  { label: "Sent", value: campaign.totalSent, color: "bg-blue-500" },
                  { label: "Delivered", value: campaign.totalDelivered, color: "bg-green-500" },
                  { label: "Opens", value: campaign.totalOpens, color: "bg-emerald-500" },
                  { label: "Unique opens", value: campaign.totalUniqueOpens, color: "bg-teal-500" },
                  { label: "Clicks", value: campaign.totalClicks, color: "bg-yellow-500" },
                  { label: "Bounced", value: campaign.totalBounces, color: "bg-red-500" },
                  { label: "Unsubscribed", value: campaign.totalUnsubscribes, color: "bg-gray-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${color}`} />
                      <span className="text-gray-600">{label}</span>
                    </div>
                    <span className="font-medium text-gray-900">
                      {value.toLocaleString()}
                    </span>
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
          <CardHeader>
            <CardTitle>Recent events</CardTitle>
          </CardHeader>
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
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          e.type === "opened"
                            ? "bg-green-100 text-green-700"
                            : e.type === "clicked"
                            ? "bg-blue-100 text-blue-700"
                            : e.type === "bounced"
                            ? "bg-red-100 text-red-700"
                            : e.type === "delivered"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {e.type}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-gray-700">{e.email}</td>
                    <td className="px-5 py-2.5 text-gray-400 max-w-[200px] truncate">
                      {e.url ?? "—"}
                    </td>
                    <td className="px-5 py-2.5 text-gray-400">
                      {format(new Date(e.createdAt), "MMM d, HH:mm")}
                    </td>
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
