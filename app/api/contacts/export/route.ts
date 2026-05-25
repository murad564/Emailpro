export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { decodeTags } from "@/lib/serialize";
import Papa from "papaparse";

export async function GET() {
  const user = await getCurrentUser();
  const contacts = await prisma.contact.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const csv = Papa.unparse(
    contacts.map((c) => ({
      email:       c.email,
      firstName:   c.firstName ?? "",
      lastName:    c.lastName  ?? "",
      tags:        decodeTags(c.tags).join(", "),
      subscribedAt: c.subscribedAt.toISOString(),
    })),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="contacts-${Date.now()}.csv"`,
    },
  });
}
