export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { encodeTags, decodeTags, deserializeSegments, deserializeContacts } from "@/lib/serialize";
import { contactHasAnyTag } from "@/lib/tags";
import { z } from "zod";

const schema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  filterType:  z.enum(["all", "tags"]).default("all"),
  filterTags:  z.array(z.string()).optional().default([]),
});

export async function GET() {
  const user = await getCurrentUser();
  const rawSegs = await prisma.segment.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const allContacts = await prisma.contact.findMany({ where: { userId: user.id } });

  const withCounts = rawSegs.map((seg) => {
    const filterTags = decodeTags(seg.filterTags);
    const count =
      seg.filterType === "tags" && filterTags.length > 0
        ? allContacts.filter((c) => contactHasAnyTag(c.tags, filterTags)).length
        : allContacts.length;
    return { ...deserializeSegments([seg])[0], contactCount: count };
  });

  return NextResponse.json(withCounts);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json();
  const parse = schema.safeParse(body);
  if (!parse.success)
    return NextResponse.json({ error: parse.error.errors[0].message }, { status: 400 });

  const { filterTags, ...rest } = parse.data;
  const segment = await prisma.segment.create({
    data: { ...rest, filterTags: encodeTags(filterTags), userId: user.id },
  });
  return NextResponse.json(deserializeSegments([segment])[0], { status: 201 });
}
