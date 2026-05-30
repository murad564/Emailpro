const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export interface BrevoEmailPayload {
  fromName:    string;
  fromEmail:   string;
  toEmail:     string;
  toName?:     string;
  replyTo?:    string;
  subject:     string;
  html:        string;
  text?:       string;
  campaignId?: string;
  tags?:       string[];
}

export interface BrevoSendResult {
  messageId: string | null;
  error?:    string;
}

export async function sendBrevoEmail(
  payload: BrevoEmailPayload,
  overrideApiKey?: string,
): Promise<BrevoSendResult> {
  const apiKey = overrideApiKey || process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("Brevo API key is not configured. Add it in Settings.");

  const body: Record<string, unknown> = {
    sender:      { name: payload.fromName, email: payload.fromEmail },
    to:          [{ email: payload.toEmail, ...(payload.toName && { name: payload.toName }) }],
    subject:     payload.subject,
    htmlContent: payload.html,
    ...(payload.text    && { textContent: payload.text }),
    ...(payload.replyTo && { replyTo: { email: payload.replyTo } }),
    ...(payload.tags?.length && { tags: payload.tags }),
  };

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "accept":       "application/json",
      "api-key":      apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(`Brevo API error ${res.status}: ${err.message ?? res.statusText}`);
  }

  const data = await res.json() as { messageId?: string };
  return { messageId: data.messageId ?? null };
}
