import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { encodeTags } from "@/lib/serialize";
import { z } from "zod";

const schema = z.object({
  name:        z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  filterType:  z.enum(["all", "tags"]).optional(),
  filterTags:  z.array(z.string()).optional(),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const body = await req.json();
  const parse = schema.safeParse(body);
  if (!parse.success)
    return NextResponse.json({ error: parse.error.errors[0].message }, { status: 400 });

  const { filterTags, ...rest } = parse.data;
  const data = { ...rest, ...(filterTags !== undefined && { filterTags: encodeTags(filterTags) }) };

  const result = await prisma.segment.updateMany({
    where: { id: params.id, userId: user.id },
    data,
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  await prisma.segment.deleteMany({ where: { id: params.id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
