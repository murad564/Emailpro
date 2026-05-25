import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const unsub = await prisma.unsubscribe.findUnique({ where: { token } });
  if (!unsub) return NextResponse.json({ error: "Invalid token" }, { status: 404 });

  // Record unsubscribe event if campaign exists
  if (unsub.campaignId) {
    const alreadyUnsub = await prisma.emailEvent.findFirst({
      where: { email: unsub.email, type: "unsubscribed", campaignId: unsub.campaignId },
    });

    if (!alreadyUnsub) {
      await Promise.all([
        prisma.emailEvent.create({
          data: {
            type: "unsubscribed",
            campaignId: unsub.campaignId,
            contactId: unsub.contactId,
            email: unsub.email,
          },
        }),
        prisma.campaign.update({
          where: { id: unsub.campaignId },
          data: { totalUnsubscribes: { increment: 1 } },
        }),
      ]);
    }
  }

  return NextResponse.json({ ok: true, email: unsub.email });
}
