import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(
  _req: Request,
  { params }: { params: { trackingId: string } },
) {
  try {
    const event = await prisma.emailEvent.findUnique({
      where: { trackingId: params.trackingId },
    });

    if (event && event.type === "sent") {
      const campaignId = event.campaignId;

      // Check if already opened (deduplicate unique opens)
      const alreadyOpened = await prisma.emailEvent.findFirst({
        where: {
          campaignId,
          email: event.email,
          type: "opened",
        },
      });

      // Record open event
      await prisma.emailEvent.create({
        data: {
          type: "opened",
          campaignId,
          contactId: event.contactId,
          email: event.email,
        },
      });

      // Update campaign counters
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          totalOpens: { increment: 1 },
          ...(!alreadyOpened && { totalUniqueOpens: { increment: 1 } }),
        },
      });
    }
  } catch {
    // Silently fail — never break email rendering
  }

  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
