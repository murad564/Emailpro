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

  const [campaigns, events, totalContacts, unsubCount] = await Promise.all([
    prisma.campaign.findMany({ where: { userId: user.id, status: "sent" }, orderBy: { sentAt: "desc" } }),
    prisma.emailEvent.findMany({
      where: { campaign: { userId: user.id }, createdAt: { gte: subDays(new Date(), 30) } },
      select: { type: true, createdAt: true },
    }),
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.unsubscribe.count({ where: { contact: { userId: user.id } } }),
  ]);

  const totalSent    = campaigns.reduce((a, c) => a + c.totalSent, 0);
  const totalOpens   = campaigns.reduce((a, c) => a + c.totalUniqueOpens, 0);
  const totalClicks  = campaigns.reduce((a, c) => a + c.totalUniqueClicks, 0);
  const totalBounces = campaigns.reduce((a, c) => a + c.totalBounces, 0);

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
  const barData  = campaigns.slice(0, 8).map((c) => ({
    name: c.name.length > 14 ? c.name.slice(0, 14) + "…" : c.name,
    opens: c.totalUniqueOpens, clicks: c.totalUniqueClicks, bounces: c.totalBounces,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">Aggregate performance across all campaigns</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Total Sent"    value={formatNumber(totalSent)}    icon={<Send className="w-5 h-5" />} />
        <StatsCard label="Avg Open Rate" value={pct(totalOpens, totalSent)}  sub={`${formatNumber(totalOpens)} unique opens`}  icon={<BarChart2 className="w-5 h-5" />} />
        <StatsCard label="Avg Click Rate" value={pct(totalClicks, totalSent)} sub={`${formatNumber(totalClicks)} unique clicks`} icon={<MousePointerClick className="w-5 h-5" />} />
        <StatsCard label="Bounce Rate"   value={pct(totalBounces, totalSent)} sub={`${formatNumber(unsubCount)} unsubscribed`} icon={<Users className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>30-Day Activity</CardTitle></CardHeader>
          <CardContent><SendsLineChart data={lineData} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Campaign Comparison</CardTitle></CardHeader>
          <CardContent>
            {barData.length > 0 ? <CampaignBarChart data={barData} /> : (
              <div className="flex items-center justify-center h-[280px] text-sm text-gray-400">No sent campaigns yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>All Campaigns</CardTitle></CardHeader>
        <CardContent className="p-0">
          {campaigns.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-gray-400">
              No sent campaigns yet.{" "}
              <Link href="/campaigns/new" className="text-brand-600 hover:underline">Create one →</Link>
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["Campaign","Status","Sent","Open %","Click %","Bounce %","Unsub","Sent At"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <Link href={`/campaigns/${c.id}`} className="font-medium text-gray-900 hover:text-brand-600">{c.name}</Link>
                      <p className="text-xs text-gray-400 truncate max-w-[180px]">{c.subject}</p>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-5 py-3 text-gray-700">{c.totalSent.toLocaleString()}</td>
                    <td className="px-5 py-3 text-gray-700">{pct(c.totalUniqueOpens,  c.totalSent)}</td>
                    <td className="px-5 py-3 text-gray-700">{pct(c.totalUniqueClicks, c.totalSent)}</td>
                    <td className="px-5 py-3 text-gray-700">{pct(c.totalBounces,      c.totalSent)}</td>
                    <td className="px-5 py-3 text-gray-700">{c.totalUnsubscribes}</td>
                    <td className="px-5 py-3 text-gray-400">{c.sentAt ? format(new Date(c.sentAt), "MMM d, yyyy") : "—"}</td>
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
