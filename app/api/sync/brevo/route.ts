import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

interface BrevoStatEvent {
  email:      string;
  date:       string;
  messageId?: string;
  event:      string;
  link?:      string;
  ts_epoch?:  number;
}

const BREVO_TYPE_MAP: Record<string, string> = {
  delivered:    "delivered",
  opens:        "opened",
  clicks:       "clicked",
  hardBounces:  "bounced",
  softBounces:  "bounced",
  unsubscribed: "unsubscribed",
  spam:         "complained",
};

async function fetchAllBrevoEvents(tag: string, apiKey: string): Promise<BrevoStatEvent[]> {
  const all: BrevoStatEvent[] = [];
  let offset = 0;

  while (true) {
    const url = `https://api.brevo.com/v3/smtp/statistics/events?tags=${encodeURIComponent(tag)}&limit=100&offset=${offset}&sort=asc`;
    const res = await fetch(url, { headers: { "api-key": apiKey, accept: "application/json" } });
    if (!res.ok) break;

    const data = (await res.json()) as { events?: BrevoStatEvent[] };
    const batch = data.events ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }

  return all;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const { campaignId } = (await req.json().catch(() => ({}))) as { campaignId?: string };

  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const apiKey   = settings?.brevoApiKey || process.env.BREVO_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Brevo API key not configured" }, { status: 400 });

  const campaigns = await prisma.campaign.findMany({
    where: { userId: user.id, status: "sent", ...(campaignId ? { id: campaignId } : {}) },
    select: { id: true },
  });

  let imported = 0;

  for (const campaign of campaigns) {
    const brevoEvents = await fetchAllBrevoEvents(campaign.id, apiKey);

    for (const ev of brevoEvents) {
      const mappedType = BREVO_TYPE_MAP[ev.event];
      if (!mappedType) continue;

      // Idempotent key — stored in resendId so re-syncing never duplicates
      const dedupKey = `brevo_sync:${ev.email}:${ev.event}:${ev.ts_epoch ?? ev.date}`;

      const exists = await prisma.emailEvent.findFirst({
        where: { campaignId: campaign.id, resendId: dedupKey },
        select: { id: true },
      });
      if (exists) continue;

      const sentEvent = await prisma.emailEvent.findFirst({
        where: { campaignId: campaign.id, email: ev.email, type: "sent" },
        orderBy: { createdAt: "asc" },
        select: { contactId: true },
      });

      await prisma.emailEvent.create({
        data: {
          type:       mappedType,
          campaignId: campaign.id,
          contactId:  sentEvent?.contactId ?? null,
          email:      ev.email,
          url:        ev.link ?? null,
          resendId:   dedupKey,
          metadata:   JSON.stringify(ev),
          createdAt:  new Date(ev.date),
        },
      });

      imported++;
    }

    // Recompute counters from the event table so they're always consistent
    const [delivered, opens, uniqueOpenRows, clicks, uniqueClickRows, bounces, unsubscribes] =
      await Promise.all([
        prisma.emailEvent.count({ where: { campaignId: campaign.id, type: "delivered" } }),
        prisma.emailEvent.count({ where: { campaignId: campaign.id, type: "opened" } }),
        prisma.emailEvent.findMany({
          where:    { campaignId: campaign.id, type: "opened" },
          select:   { email: true },
          distinct: ["email"],
        }),
        prisma.emailEvent.count({ where: { campaignId: campaign.id, type: "clicked" } }),
        prisma.emailEvent.findMany({
          where:    { campaignId: campaign.id, type: "clicked" },
          select:   { email: true },
          distinct: ["email"],
        }),
        prisma.emailEvent.count({ where: { campaignId: campaign.id, type: "bounced" } }),
        prisma.emailEvent.count({ where: { campaignId: campaign.id, type: "unsubscribed" } }),
      ]);

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        totalDelivered:    delivered,
        totalOpens:        opens,
        totalUniqueOpens:  uniqueOpenRows.length,
        totalClicks:       clicks,
        totalUniqueClicks: uniqueClickRows.length,
        totalBounces:      bounces,
        totalUnsubscribes: unsubscribes,
      },
    });
  }

  return NextResponse.json({ ok: true, imported, campaigns: campaigns.length });
}
