"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, CheckCircle2, AlertCircle, Send } from "lucide-react";

interface Props {
  initialApiKey: string;
  initialDailySendLimit: number;
}

export function SettingsForm({ initialApiKey, initialDailySendLimit }: Props) {
  const [apiKey, setApiKey]             = useState(initialApiKey);
  const [dailySendLimit, setDailySendLimit] = useState(String(initialDailySendLimit));
  const [visible, setVisible]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [saveError, setSaveError] = useState("");

  const [toEmail, setToEmail]     = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName]   = useState("");
  const [htmlBody, setHtmlBody]   = useState(
    `<p>This is a test email from <strong>EmailPro</strong>.</p>\n<p>If you received this, your Brevo API key and sender address are working correctly.</p>`
  );
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok?: boolean; error?: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    setSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brevoApiKey: apiKey, dailySendLimit: Number(dailySendLimit) || 300 }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/settings/test-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toEmail, fromEmail, fromName, htmlBody }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setTestResult(data);
    } catch {
      setTestResult({ error: "Request failed. Check the console." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Brevo API Key */}
      <form onSubmit={handleSave} className="space-y-4 max-w-lg">
        <div>
          <div className="relative">
            <Input
              label="Brevo API Key"
              type={visible ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="xkeysib-..."
              error={saveError}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute right-2.5 top-[30px] text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            Get your key at{" "}
            <span className="font-medium text-gray-700">app.brevo.com → Settings → API Keys → Generate a new API key</span>
          </p>
        </div>

        <Input
          label="Daily send limit"
          type="number"
          min="1"
          value={dailySendLimit}
          onChange={(e) => setDailySendLimit(e.target.value)}
          hint="Free plan: 300/day. Upgrade Brevo plan and increase this if needed."
        />

        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving}>
            Save API Key
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              Saved
            </span>
          )}
        </div>
      </form>

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Test Send */}
      <form onSubmit={handleTestSend} className="space-y-4 max-w-lg">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Send Test Email</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Verify your API key and sender address work by sending a test email.
            The sender email must be a{" "}
            <span className="font-medium text-gray-700">verified sender</span> in your Brevo account.
          </p>
        </div>

        <Input
          label="From Name"
          type="text"
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="Your Company"
          required
        />
        <Input
          label="From Email"
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="hello@yourdomain.com"
          hint="Must be verified in Brevo (Senders & IP → Senders)"
          required
        />
        <Input
          label="Send Test To"
          type="email"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          placeholder="incoming@aristokrat.az"
          required
        />

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">HTML Body</label>
          <textarea
            value={htmlBody}
            onChange={(e) => setHtmlBody(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
            placeholder="<p>Your custom HTML email body...</p>"
          />
          <p className="text-xs text-gray-500">Paste or write any HTML — this is what will be sent as the email body.</p>
        </div>

        {testResult && (
          <div
            className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
              testResult.ok
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{testResult.ok ? "Test email sent! Check your inbox." : testResult.error}</span>
          </div>
        )}

        <Button type="submit" variant="secondary" loading={testing}>
          <Send className="w-4 h-4" />
          Send Test Email
        </Button>
      </form>
    </div>
  );
}
