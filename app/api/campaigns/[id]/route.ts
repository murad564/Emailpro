import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  fromName: z.string().min(1).optional(),
  fromEmail: z.string().email().optional(),
  replyTo: z.string().email().nullable().optional(),
  htmlContent: z.string().optional(),
  textContent: z.string().nullable().optional(),
  segmentId: z.string().nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      segment: true,
      emailEvents: {
        where: { type: { notIn: ["sent", "link_registered"] } },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(campaign);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const body = await req.json();
  const parse = updateSchema.safeParse(body);
  if (!parse.success)
    return NextResponse.json({ error: parse.error.errors[0].message }, { status: 400 });

  const result = await prisma.campaign.updateMany({
    where: { id: params.id, userId: user.id, status: "draft" },
    data: parse.data,
  });
  if (result.count === 0)
    return NextResponse.json({ error: "Not found or already sent" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  await prisma.campaign.deleteMany({ where: { id: params.id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
