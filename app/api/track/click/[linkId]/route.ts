import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: { linkId: string } },
) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url") ?? "/";

  try {
    const event = await prisma.emailEvent.findUnique({
      where: { trackingId: params.linkId },
    });

    if (event) {
      const campaignId = event.campaignId;

      const alreadyClicked = await prisma.emailEvent.findFirst({
        where: {
          campaignId,
          email: event.email,
          type: "clicked",
          url,
        },
      });

      await prisma.emailEvent.create({
        data: {
          type: "clicked",
          campaignId,
          contactId: event.contactId,
          email: event.email,
          url,
        },
      });

      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          totalClicks: { increment: 1 },
          ...(!alreadyClicked && { totalUniqueClicks: { increment: 1 } }),
        },
      });
    }
  } catch {
    // Silently fail
  }

  // Validate URL to prevent open redirects (allow only http/https)
  let target = "/";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      target = url;
    }
  } catch {
    target = "/";
  }

  return NextResponse.redirect(target, { status: 302 });
}
