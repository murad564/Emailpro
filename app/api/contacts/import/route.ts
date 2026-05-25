import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { encodeTags } from "@/lib/serialize";
import Papa from "papaparse";

interface CsvRow {
  email?: string; Email?: string; EMAIL?: string;
  firstName?: string; first_name?: string;
  lastName?: string;  last_name?: string;
  tags?: string; Tags?: string;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const text = await file.text();
  const parsed = Papa.parse<CsvRow>(text, {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
  });

  let imported = 0, skipped = 0;
  const errors: string[] = [];

  for (const row of parsed.data) {
    const email = (row.email ?? row.Email ?? row.EMAIL ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { skipped++; continue; }

    const firstName = (row.firstName ?? row.first_name ?? "").trim() || null;
    const lastName  = (row.lastName  ?? row.last_name  ?? "").trim() || null;
    const tagsRaw   = (row.tags ?? row.Tags ?? "").trim();
    const tags      = tagsRaw ? tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [];

    try {
      await prisma.contact.upsert({
        where: { email_userId: { email, userId: user.id } },
        create: { email, firstName, lastName, tags: encodeTags(tags), userId: user.id },
        update: {
          firstName: firstName ?? undefined,
          lastName:  lastName  ?? undefined,
          ...(tags.length > 0 && { tags: encodeTags(tags) }),
        },
      });
      imported++;
    } catch (err) {
      errors.push(`${email}: ${(err as Error).message}`);
      skipped++;
    }
  }

  return NextResponse.json({ imported, skipped, errors: errors.slice(0, 10) });
}
