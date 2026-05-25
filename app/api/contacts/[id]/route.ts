import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { encodeTags, deserializeContacts } from "@/lib/serialize";
import { z } from "zod";

const updateSchema = z.object({
  email:     z.string().email().optional(),
  firstName: z.string().nullable().optional(),
  lastName:  z.string().nullable().optional(),
  tags:      z.array(z.string()).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const c = await prisma.contact.findFirst({ where: { id: params.id, userId: user.id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(deserializeContacts([c])[0]);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const body = await req.json();
  const parse = updateSchema.safeParse(body);
  if (!parse.success)
    return NextResponse.json({ error: parse.error.errors[0].message }, { status: 400 });

  const { tags, ...rest } = parse.data;
  const data = { ...rest, ...(tags !== undefined && { tags: encodeTags(tags) }) };

  const result = await prisma.contact.updateMany({
    where: { id: params.id, userId: user.id },
    data,
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  await prisma.contact.deleteMany({ where: { id: params.id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
