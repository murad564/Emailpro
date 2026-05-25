import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { id, email } = await req.json();
    if (!id || !email) {
      return NextResponse.json({ error: "id and email required" }, { status: 400 });
    }

    await prisma.user.upsert({
      where: { id },
      create: { id, email },
      update: { email },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Provision error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
