import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { sendBrevoEmail } from "@/lib/brevo";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const { toEmail, fromEmail, fromName, htmlBody } = (await req.json()) as {
    toEmail?: string;
    fromEmail?: string;
    fromName?: string;
    htmlBody?: string;
  };

  if (!toEmail || !fromEmail || !fromName) {
    return NextResponse.json({ error: "toEmail, fromEmail and fromName are required" }, { status: 400 });
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const apiKey = settings?.brevoApiKey || process.env.BREVO_API_KEY;

  if (!apiKey || apiKey === "paste-your-key-here") {
    return NextResponse.json({ error: "No Brevo API key configured. Save your key in Settings first." }, { status: 400 });
  }

  try {
    const result = await sendBrevoEmail(
      {
        fromName,
        fromEmail,
        toEmail,
        subject: "EmailPro — Test Email",
        html: htmlBody?.trim()
          ? htmlBody
          : `<p>This is a test email from <strong>EmailPro</strong>.</p><p>If you received this, your Brevo API key and sender address are working correctly.</p>`,
        text: "This is a test email from EmailPro. If you received this, your Brevo API key and sender address are working correctly.",
      },
      apiKey,
    );
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
