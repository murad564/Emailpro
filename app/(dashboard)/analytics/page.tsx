export const dynamic = "force-dynamic";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/dashboard/stats-card";
import { SendsLineChart, CampaignBarChart } from "@/components/dashboard/charts";
import { StatusBadge } from "@/components/ui/badge";
import { pct, formatNumber } from "@/lib/utils";
import { subDays, format } from "date-fns";
import { BarChart2, Send, MousePointerClick, Users } from "lucide-react";
import Link from "next/link";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();

  const [
    campaigns,
    sentEvents,
    openPairs,
    clickPairs,
    bouncedEvents,
    unsubCount,
    recentEvents,
    totalContacts,
  ] = await Promise.all([
    // Campaign metadata (no counters — stats come from event table)
    prisma.campaign.findMany({
      where: { userId: user.id, status: "sent" },
      orderBy: { sentAt: "desc" },
      select: { id: true, name: true, subject: true, status: true, sentAt: true },
    }),
    // Actual sent attempts per campaign (from event table)
    prisma.emailEvent.groupBy({
      by: ["campaignId"],
      where: { type: "sent", campaign: { userId: user.id } },
      _count: { _all: true },
    }),
    // Unique opens: one row per (campaignId, email) pair
    prisma.emailEvent.findMany({
      where: { type: "opened", campaign: { userId: user.id } },
      select: { campaignId: true, email: true },
      distinct: ["campaignId", "email"],
    }),
    // Unique clicks: one row per (campaignId, email) pair
    prisma.emailEvent.findMany({
      where: { type: "clicked", campaign: { userId: user.id } },
      select: { campaignId: true, email: true },
      distinct: ["campaignId", "email"],
    }),
    // Bounces per campaign
    prisma.emailEvent.groupBy({
      by: ["campaignId"],
      where: { type: "bounced", campaign: { userId: user.id } },
      _count: { _all: true },
    }),
    prisma.unsubscribe.count({ where: { contact: { userId: user.id } } }),
    // Last 30 days events for the activity chart
    prisma.emailEvent.findMany({
      where: {
        campaign: { userId: user.id },
        createdAt: { gte: subDays(new Date(), 30) },
        type: { in: ["sent", "opened", "clicked"] },
      },
      select: { type: true, createdAt: true },
    }),
    prisma.contact.count({ where: { userId: user.id } }),
  ]);

  // ── Per-campaign lookup maps ───────────────────────────────────────────────
  const sentByCampaign = Object.fromEntries(
    sentEvents.map((e) => [e.campaignId, e._count._all]),
  );

  const uniqueOpensByCampaign: Record<string, number> = {};
  openPairs.forEach((e) => {
    uniqueOpensByCampaign[e.campaignId] = (uniqueOpensByCampaign[e.campaignId] ?? 0) + 1;
  });

  const uniqueClicksByCampaign: Record<string, number> = {};
  clickPairs.forEach((e) => {
    uniqueClicksByCampaign[e.campaignId] = (uniqueClicksByCampaign[e.campaignId] ?? 0) + 1;
  });

  const bouncesByCampaign = Object.fromEntries(
    bouncedEvents.map((e) => [e.campaignId, e._count._all]),
  );

  // ── Global totals (derived from event table) ───────────────────────────────
  const totalSent        = sentEvents.reduce((a, e) => a + e._count._all, 0);
  const totalUniqueOpens = openPairs.length;
  const totalUniqueClicks = clickPairs.length;
  const totalBounces     = bouncedEvents.reduce((a, e) => a + e._count._all, 0);

  // ── 30-day activity chart ──────────────────────────────────────────────────
  const dayMap: Record<string, { sent: number; opens: number; clicks: number }> = {};
  for (let i = 29; i >= 0; i--) {
    dayMap[format(subDays(new Date(), i), "MMM d")] = { sent: 0, opens: 0, clicks: 0 };
  }
  recentEvents.forEach((e) => {
    const d = format(e.createdAt, "MMM d");
    if (!dayMap[d]) return;
    if (e.type === "sent")   dayMap[d].sent++;
    if (e.type === "opened") dayMap[d].opens++;
    if (e.type === "clicked") dayMap[d].clicks++;
  });
  const lineData = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

  // ── Campaign comparison bar chart (top 8) ─────────────────────────────────
  const barData = campaigns.slice(0, 8).map((c) => ({
    name: c.name.length > 14 ? c.name.slice(0, 14) + "…" : c.name,
    opens:   uniqueOpensByCampaign[c.id]  ?? 0,
    clicks:  uniqueClicksByCampaign[c.id] ?? 0,
    bounces: bouncesByCampaign[c.id]      ?? 0,
  }));

  // ── Campaign table rows ───────────────────────────────────────────────────
  const campaignRows = campaigns.map((c) => ({
    ...c,
    sent:         sentByCampaign[c.id]        ?? 0,
    uniqueOpens:  uniqueOpensByCampaign[c.id]  ?? 0,
    uniqueClicks: uniqueClicksByCampaign[c.id] ?? 0,
    bounces:      bouncesByCampaign[c.id]      ?? 0,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          All metrics are computed from real email events — {formatNumber(totalContacts)} contacts
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Total Sent"
          value={formatNumber(totalSent)}
          sub={`across ${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""}`}
          icon={<Send className="w-5 h-5" />}
        />
        <StatsCard
          label="Avg Open Rate"
          value={pct(totalUniqueOpens, totalSent)}
          sub={`${formatNumber(totalUniqueOpens)} unique opens`}
          icon={<BarChart2 className="w-5 h-5" />}
        />
        <StatsCard
          label="Avg Click Rate"
          value={pct(totalUniqueClicks, totalSent)}
          sub={`${formatNumber(totalUniqueClicks)} unique clicks`}
          icon={<MousePointerClick className="w-5 h-5" />}
        />
        <StatsCard
          label="Bounce Rate"
          value={pct(totalBounces, totalSent)}
          sub={`${formatNumber(unsubCount)} unsubscribed`}
          icon={<Users className="w-5 h-5" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>30-Day Activity</CardTitle></CardHeader>
          <CardContent><SendsLineChart data={lineData} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Campaign Comparison</CardTitle></CardHeader>
          <CardContent>
            {barData.some((d) => d.opens + d.clicks + d.bounces > 0) ? (
              <CampaignBarChart data={barData} />
            ) : (
              <div className="flex items-center justify-center h-[280px] text-sm text-gray-400">
                No open / click events recorded yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>All Campaigns</CardTitle></CardHeader>
        <CardContent className="p-0">
          {campaignRows.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-gray-400">
              No sent campaigns yet.{" "}
              <Link href="/campaigns/new" className="text-brand-600 hover:underline">
                Create one →
              </Link>
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["Campaign", "Status", "Sent", "Open %", "Click %", "Bounce %", "Unsub", "Sent At"].map(
                    (h) => (
                      <th key={h} className="px-5 py-3 text-left font-medium text-gray-500">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {campaignRows.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium text-gray-900 hover:text-brand-600"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-gray-400 truncate max-w-[180px]">{c.subject}</p>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-5 py-3 text-gray-700">{c.sent.toLocaleString()}</td>
                    <td className="px-5 py-3 text-gray-700">{pct(c.uniqueOpens,  c.sent)}</td>
                    <td className="px-5 py-3 text-gray-700">{pct(c.uniqueClicks, c.sent)}</td>
                    <td className="px-5 py-3 text-gray-700">{pct(c.bounces,      c.sent)}</td>
                    <td className="px-5 py-3 text-gray-700">{unsubCount}</td>
                    <td className="px-5 py-3 text-gray-400">
                      {c.sentAt ? format(new Date(c.sentAt), "MMM d, yyyy") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
