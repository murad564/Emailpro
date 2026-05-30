export const dynamic = "force-dynamic";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { StatsCard } from "@/components/dashboard/stats-card";
import { SendsLineChart, CampaignBarChart, EventPieChart } from "@/components/dashboard/charts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { pct, formatNumber } from "@/lib/utils";
import { Users, Send, BarChart2, MousePointerClick } from "lucide-react";
import { subDays, format } from "date-fns";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  const [totalContacts, totalCampaigns, recentCampaigns, events, recentSentEvents, recentOpenPairs, recentClickPairs] =
    await Promise.all([
      prisma.contact.count({ where: { userId: user.id } }),
      prisma.campaign.count({ where: { userId: user.id } }),
      prisma.campaign.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, status: true, sentAt: true },
      }),
      prisma.emailEvent.findMany({
        where: { campaign: { userId: user.id }, createdAt: { gte: subDays(new Date(), 30) }, type: { in: ["sent", "opened", "clicked"] } },
        select: { type: true, createdAt: true },
      }),
      // Last 30 days: sent count from event table
      prisma.emailEvent.count({
        where: { type: "sent", campaign: { userId: user.id }, createdAt: { gte: subDays(new Date(), 30) } },
      }),
      // Last 30 days: unique opens
      prisma.emailEvent.findMany({
        where: { type: "opened", campaign: { userId: user.id }, createdAt: { gte: subDays(new Date(), 30) } },
        select: { campaignId: true, email: true },
        distinct: ["campaignId", "email"],
      }),
      // Last 30 days: unique clicks
      prisma.emailEvent.findMany({
        where: { type: "clicked", campaign: { userId: user.id }, createdAt: { gte: subDays(new Date(), 30) } },
        select: { campaignId: true, email: true },
        distinct: ["campaignId", "email"],
      }),
    ]);

  const dayMap: Record<string, { sent: number; opens: number; clicks: number }> = {};
  for (let i = 29; i >= 0; i--) {
    dayMap[format(subDays(new Date(), i), "MMM d")] = { sent: 0, opens: 0, clicks: 0 };
  }
  events.forEach((e) => {
    const d = format(e.createdAt, "MMM d");
    if (!dayMap[d]) return;
    if (e.type === "sent") dayMap[d].sent++;
    if (e.type === "opened") dayMap[d].opens++;
    if (e.type === "clicked") dayMap[d].clicks++;
  });
  const lineData = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

  const barData = recentCampaigns.map((c) => ({
    name: c.name.length > 14 ? c.name.slice(0, 14) + "…" : c.name,
    opens: 0, clicks: 0, bounces: 0,
  }));

  const typeCounts: Record<string, number> = {};
  events.forEach((e) => { typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1; });
  const pieData = Object.entries(typeCounts).map(([name, value]) => ({ name, value }));

  const totalSent   = recentSentEvents;
  const totalOpens  = recentOpenPairs.length;
  const totalClicks = recentClickPairs.length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Last 30 days overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Total Contacts" value={formatNumber(totalContacts)} icon={<Users className="w-5 h-5" />} />
        <StatsCard label="Campaigns" value={totalCampaigns} icon={<Send className="w-5 h-5" />} />
        <StatsCard label="Open Rate" value={pct(totalOpens, totalSent)} sub={`${totalOpens} opens`} icon={<BarChart2 className="w-5 h-5" />} />
        <StatsCard label="Click Rate" value={pct(totalClicks, totalSent)} sub={`${totalClicks} clicks`} icon={<MousePointerClick className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Sends / Opens / Clicks</CardTitle></CardHeader>
          <CardContent><SendsLineChart data={lineData} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Event Distribution</CardTitle></CardHeader>
          <CardContent>
            {pieData.length > 0 ? <EventPieChart data={pieData} /> : (
              <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">No events yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Recent Campaigns</CardTitle></CardHeader>
          <CardContent className="p-0">
            {recentCampaigns.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-400 text-center">
                No campaigns yet.{" "}
                <Link href="/campaigns/new" className="text-brand-600 hover:underline">Create one →</Link>
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {recentCampaigns.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <Link href={`/campaigns/${c.id}`} className="font-medium text-gray-900 hover:text-brand-600">{c.name}</Link>
                      </td>
                      <td className="px-3 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-3 py-3 text-gray-500">{c.status === "sent" ? "sent" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Campaign Performance</CardTitle></CardHeader>
          <CardContent>
            {barData.length > 0 ? <CampaignBarChart data={barData} /> : (
              <div className="flex items-center justify-center h-[280px] text-sm text-gray-400">No data yet</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
