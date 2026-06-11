export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { encodeTags, decodeTags, deserializeSegments } from "@/lib/serialize";
import { contactHasAnyTag } from "@/lib/tags";
import { z } from "zod";

const schema = z.object({
  name:         z.string().min(1),
  description:  z.string().optional(),
  filterType:   z.enum(["all", "tags", "manual"]).default("all"),
  filterTags:   z.array(z.string()).optional().default([]),
  manualIds:    z.array(z.string()).optional().default([]),
  contactLimit: z.number().int().positive().nullable().optional(),
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
    const manualIds  = decodeTags(seg.manualIds);

    let count: number;
    if (seg.filterType === "manual") {
      count = manualIds.length;
    } else if (seg.filterType === "tags" && filterTags.length > 0) {
      count = allContacts.filter((c) => contactHasAnyTag(c.tags, filterTags)).length;
    } else {
      count = allContacts.length;
    }

    if (seg.filterType !== "manual" && seg.contactLimit && seg.contactLimit > 0) {
      count = Math.min(count, seg.contactLimit);
    }

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

  const { filterTags, manualIds, contactLimit, ...rest } = parse.data;
  const segment = await prisma.segment.create({
    data: {
      ...rest,
      filterTags:   encodeTags(filterTags),
      manualIds:    encodeTags(manualIds),
      contactLimit: contactLimit ?? null,
      userId:       user.id,
    },
  });
  return NextResponse.json(deserializeSegments([segment])[0], { status: 201 });
}
