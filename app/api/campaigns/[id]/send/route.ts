import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { sendCampaign } from "@/lib/bulk-sender";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  try {
    const result = await sendCampaign(params.id, user.id);
    return NextResponse.json({ ok: true, totalSent: result.totalSent, errors: result.errors, skipped: result.skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
