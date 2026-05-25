export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { encodeTags, deserializeContacts } from "@/lib/serialize";
import { z } from "zod";

const createSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, Number(searchParams.get("page")  ?? "1"));
  const limit = Math.min(100, Number(searchParams.get("limit") ?? "25"));
  const search = searchParams.get("search") ?? "";

  const where = {
    userId: user.id,
    ...(search && {
      OR: [
        { email:     { contains: search } },
        { firstName: { contains: search } },
        { lastName:  { contains: search } },
      ],
    }),
  };

  const [raw, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return NextResponse.json({ contacts: deserializeContacts(raw), total, page, limit });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json();
  const parse = createSchema.safeParse(body);
  if (!parse.success)
    return NextResponse.json({ error: parse.error.errors[0].message }, { status: 400 });

  const { tags, ...rest } = parse.data;
  try {
    const contact = await prisma.contact.create({
      data: { ...rest, tags: encodeTags(tags), userId: user.id },
    });
    return NextResponse.json(deserializeContacts([contact])[0], { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "P2002")
      return NextResponse.json({ error: "Contact already exists" }, { status: 409 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
