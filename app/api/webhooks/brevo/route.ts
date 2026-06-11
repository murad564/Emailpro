import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

interface BrevoEvent {
  event:         string;
  email:         string;
  "message-id"?: string;
  tags?:         string[];
  url?:          string;
}

const EVENT_MAP: Record<string, string> = {
  delivered:    "delivered",
  opened:       "opened",
  clicked:      "clicked",
  hardbounce:   "bounced",
  softbounce:   "bounced",
  unsubscribed: "unsubscribed",
  spam:         "complained",
};

export async function POST(req: Request) {
  let events: BrevoEvent[];
  try {
    const body = await req.json();
    events = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  for (const ev of events) {
    const mappedType = EVENT_MAP[ev.event];
    if (!mappedType) continue;

    const email     = ev.email;
    const messageId = ev["message-id"];

    try {
      const sentEvent = messageId
        ? await prisma.emailEvent.findFirst({ where: { resendId: messageId } })
        : await prisma.emailEvent.findFirst({
            where: { email, type: "sent" },
            orderBy: { createdAt: "desc" },
          });

      if (!sentEvent) continue;
      const { campaignId, contactId } = sentEvent;

      // Determine if this is a first occurrence BEFORE creating the new event
      let isFirst = false;
      if (mappedType === "opened") {
        const prev = await prisma.emailEvent.findFirst({ where: { campaignId, email, type: "opened" } });
        isFirst = !prev;
      } else if (mappedType === "clicked") {
        const url  = ev.url ?? null;
        const prev = await prisma.emailEvent.findFirst({ where: { campaignId, email, type: "clicked", url } });
        isFirst = !prev;
      }

      await prisma.emailEvent.create({
        data: { type: mappedType, campaignId, contactId, email, url: ev.url ?? null, metadata: JSON.stringify(ev) },
      });

      // Update campaign counters
      switch (mappedType) {
        case "delivered":
          await prisma.campaign.update({ where: { id: campaignId }, data: { totalDelivered: { increment: 1 } } });
          break;
        case "opened":
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              totalOpens: { increment: 1 },
              ...(isFirst && { totalUniqueOpens: { increment: 1 } }),
            },
          });
          break;
        case "clicked":
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              totalClicks: { increment: 1 },
              ...(isFirst && { totalUniqueClicks: { increment: 1 } }),
            },
          });
          break;
        case "bounced":
          await prisma.campaign.update({ where: { id: campaignId }, data: { totalBounces: { increment: 1 } } });
          break;
        case "unsubscribed":
          await prisma.campaign.update({ where: { id: campaignId }, data: { totalUnsubscribes: { increment: 1 } } });
          break;
      }
    } catch (err) {
      console.error("Brevo webhook error:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
