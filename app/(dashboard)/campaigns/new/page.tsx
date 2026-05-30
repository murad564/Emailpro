"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TiptapEditor } from "@/components/campaigns/tiptap-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Send } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";

interface Segment {
  id: string;
  name: string;
  contactCount: number;
}

const DEFAULT_FROM_EMAIL =
  process.env.NEXT_PUBLIC_DEFAULT_FROM_EMAIL ?? "onboarding@resend.dev";
const DEFAULT_FROM_NAME = process.env.NEXT_PUBLIC_DEFAULT_FROM_NAME ?? "EmailPro";

export default function NewCampaignPage() {
  const router = useRouter();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [form, setForm] = useState({
    name: "",
    subject: "",
    fromName: DEFAULT_FROM_NAME,
    fromEmail: DEFAULT_FROM_EMAIL,
    replyTo: "",
    segmentId: "",
    htmlContent: `<h2>Hello {{firstName}}!</h2><p>Thanks for subscribing. Here's our latest update…</p>`,
    textContent: "",
  });
  const [contentTab, setContentTab] = useState<"visual" | "html" | "text">("visual");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/segments")
      .then((r) => r.json())
      .then((d) => setSegments(Array.isArray(d) ? d : []));
  }, []);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save(andSend = false): Promise<string | null> {
    if (!form.name || !form.subject || !form.htmlContent) {
      toast.error("Name, subject, and content are required");
      return null;
    }

    const payload = {
      ...form,
      segmentId: form.segmentId || null,
      replyTo: form.replyTo || null,
    };

    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to create campaign");
      return null;
    }

    const campaign = await res.json();
    return campaign.id;
  }

  async function handleSaveDraft() {
    setSaving(true);
    const id = await save();
    setSaving(false);
    if (id) {
      toast.success("Campaign saved as draft");
      router.push(`/campaigns/${id}`);
    }
  }

  async function handleSendNow() {
    if (!confirm("Send this campaign now?")) return;
    setSending(true);
    const id = await save();
    if (!id) {
      setSending(false);
      return;
    }

    const res = await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
    const data = await res.json();
    setSending(false);

    if (res.ok) {
      toast.success(`Sent to ${data.totalSent} contacts!`);
      router.push(`/campaigns/${id}`);
    } else {
      toast.error(data.error ?? "Send failed");
      router.push(`/campaigns/${id}`);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/campaigns">
          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Campaign</h1>
          <p className="text-sm text-gray-500">Compose and send a new email campaign</p>
        </div>
      </div>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Campaign settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Campaign name *"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. June Newsletter"
            />
            <div>
              <label className="text-sm font-medium text-gray-700">
                Audience segment
              </label>
              <select
                value={form.segmentId}
                onChange={(e) => set("segmentId", e.target.value)}
                className="mt-1 w-full h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">All contacts</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.contactCount.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label="Subject line *"
            value={form.subject}
            onChange={(e) => set("subject", e.target.value)}
            placeholder="Your email subject here"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="From name *"
              value={form.fromName}
              onChange={(e) => set("fromName", e.target.value)}
              placeholder="Your Name"
            />
            <Input
              label="From email *"
              type="email"
              value={form.fromEmail}
              onChange={(e) => set("fromEmail", e.target.value)}
              placeholder="you@yourdomain.com"
            />
            <Input
              label="Reply-to (optional)"
              type="email"
              value={form.replyTo}
              onChange={(e) => set("replyTo", e.target.value)}
              placeholder="replies@yourdomain.com"
            />
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Email content</CardTitle>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(["visual", "html", "text"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setContentTab(tab)}
                  className={cn(
                    "px-3 py-1.5",
                    contentTab === tab
                      ? "bg-brand-600 text-white"
                      : "text-gray-600 hover:bg-gray-50"
                  )}
                >
                  {tab === "visual" ? "Visual" : tab === "html" ? "HTML" : "Plain Text"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-4">
          {contentTab === "visual" && (
            <TiptapEditor
              value={form.htmlContent}
              onChange={(html) => set("htmlContent", html)}
            />
          )}
          {contentTab === "html" && (
            <textarea
              value={form.htmlContent}
              onChange={(e) => set("htmlContent", e.target.value)}
              className="w-full min-h-[350px] p-4 font-mono text-sm border-0 focus:outline-none resize-y"
              placeholder="<h1>Hello</h1><p>Your HTML content here…</p>"
              spellCheck={false}
            />
          )}
          {contentTab === "text" && (
            <div className="relative">
              <textarea
                value={form.textContent}
                onChange={(e) => set("textContent", e.target.value)}
                className="w-full min-h-[350px] p-4 text-sm border-0 focus:outline-none resize-y"
                placeholder="Plain text version of your email (shown to clients that don't support HTML)…"
              />
              {!form.textContent && (
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "textContent",
                      form.htmlContent.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
                    )
                  }
                  className="absolute bottom-3 right-3 text-xs text-brand-600 hover:underline"
                >
                  Generate from HTML
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pb-6">
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          loading={saving}
          disabled={sending}
        >
          Save as draft
        </Button>
        <Button
          onClick={handleSendNow}
          loading={sending}
          disabled={saving}
        >
          <Send className="w-4 h-4" />
          Send now
        </Button>
      </div>
    </div>
  );
}
