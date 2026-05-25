import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  fromName: z.string().min(1),
  fromEmail: z.string().email(),
  replyTo: z.string().email().nullable().optional(),
  htmlContent: z.string().min(1),
  textContent: z.string().optional(),
  segmentId: z.string().nullable().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  const campaigns = await prisma.campaign.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { segment: { select: { name: true } } },
  });
  return NextResponse.json(campaigns);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json();
  const parse = schema.safeParse(body);
  if (!parse.success)
    return NextResponse.json({ error: parse.error.errors[0].message }, { status: 400 });

  const campaign = await prisma.campaign.create({ data: { ...parse.data, userId: user.id } });
  return NextResponse.json(campaign, { status: 201 });
}
