import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

interface BrevoEvent {
  event:      string;
  email:      string;
  "message-id"?: string;
  tags?:      string[];
  url?:       string;
}

// Brevo event → internal event type
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
    // Brevo sends either a single object or an array
    events = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  for (const ev of events) {
    const mappedType = EVENT_MAP[ev.event];
    if (!mappedType) continue;

    const email      = ev.email;
    const messageId  = ev["message-id"];
    const trackingId = ev.tags?.find((t) => t.length > 10 && !t.includes("-") === false);

    try {
      // Find the original sent event via message-id or email
      const sentEvent = messageId
        ? await prisma.emailEvent.findFirst({ where: { resendId: messageId } })
        : await prisma.emailEvent.findFirst({
            where: { email, type: "sent" },
            orderBy: { createdAt: "desc" },
          });

      if (!sentEvent) continue;

      const { campaignId, contactId } = sentEvent;

      await prisma.emailEvent.create({
        data: {
          type: mappedType,
          campaignId,
          contactId,
          email,
          url: ev.url ?? null,
          metadata: JSON.stringify(ev),
        },
      });

      // Update campaign counters
      const updates: Record<string, object> = {
        delivered:    { totalDelivered:    { increment: 1 } },
        bounced:      { totalBounces:      { increment: 1 } },
        unsubscribed: { totalUnsubscribes: { increment: 1 } },
      };

      if (updates[mappedType]) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data:  updates[mappedType],
        });
      }
    } catch (err) {
      console.error("Brevo webhook error:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
