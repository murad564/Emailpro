import { NextResponse } from "next/server";
import { Webhook } from "svix";
import prisma from "@/lib/prisma";

interface ResendWebhookData {
  email_id?: string;
  to?: string[];
  from?: string;
}

interface ResendWebhookEvent {
  type: string;
  data: ResendWebhookData;
}

export async function POST(req: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  const body = await req.text();

  // Verify webhook signature if secret is configured
  if (webhookSecret) {
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
    }

    try {
      const wh = new Webhook(webhookSecret);
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { type, data } = event;
  const resendId = data?.email_id;
  const toEmail = data?.to?.[0];

  if (!resendId && !toEmail) {
    return NextResponse.json({ ok: true }); // Unknown event, ignore
  }

  try {
    // Find the original sent event by Resend ID or email
    const sentEvent = resendId
      ? await prisma.emailEvent.findFirst({ where: { resendId } })
      : toEmail
      ? await prisma.emailEvent.findFirst({
          where: { email: toEmail, type: "sent" },
          orderBy: { createdAt: "desc" },
        })
      : null;

    if (!sentEvent) {
      return NextResponse.json({ ok: true });
    }

    const { campaignId, contactId, email } = sentEvent;

    const eventTypeMap: Record<string, string> = {
      "email.delivered": "delivered",
      "email.opened": "opened",
      "email.clicked": "clicked",
      "email.bounced": "bounced",
      "email.complained": "complained",
    };

    const mappedType = eventTypeMap[type];
    if (!mappedType) return NextResponse.json({ ok: true });

    await prisma.emailEvent.create({
      data: { type: mappedType, campaignId, contactId, email, metadata: JSON.stringify(data) },
    });

    // Update campaign counters
    const counterMap: Record<string, object> = {
      delivered: { totalDelivered: { increment: 1 } },
      bounced: { totalBounces: { increment: 1 } },
    };

    if (counterMap[mappedType]) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: counterMap[mappedType],
      });
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }

  return NextResponse.json({ ok: true });
}
