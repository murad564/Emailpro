import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const user = await getCurrentUser();
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });
  return NextResponse.json({
    brevoApiKey: settings?.brevoApiKey ?? "",
    dailySendLimit: settings?.dailySendLimit ?? 300,
  });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  const { brevoApiKey, dailySendLimit } = (await req.json()) as {
    brevoApiKey?: string;
    dailySendLimit?: number;
  };

  const limit = dailySendLimit != null && dailySendLimit > 0 ? Math.floor(dailySendLimit) : undefined;

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {
      brevoApiKey: brevoApiKey ?? null,
      ...(limit !== undefined && { dailySendLimit: limit }),
    },
    create: {
      userId: user.id,
      brevoApiKey: brevoApiKey ?? null,
      ...(limit !== undefined && { dailySendLimit: limit }),
    },
  });

  return NextResponse.json({
    brevoApiKey: settings.brevoApiKey ?? "",
    dailySendLimit: settings.dailySendLimit,
  });
}
