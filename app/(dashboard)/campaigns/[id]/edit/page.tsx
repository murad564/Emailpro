"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TiptapEditor } from "@/components/campaigns/tiptap-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";

interface Segment { id: string; name: string; contactCount: number }

export default function EditCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [form, setForm] = useState({
    name: "", subject: "", fromName: "", fromEmail: "",
    replyTo: "", segmentId: "", htmlContent: "", textContent: "",
  });
  const [contentTab, setContentTab] = useState<"visual" | "html" | "text">("visual");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/campaigns/${params.id}`).then((r) => r.json()),
      fetch("/api/segments").then((r) => r.json()),
    ]).then(([campaign, segs]) => {
      setForm({
        name: campaign.name ?? "",
        subject: campaign.subject ?? "",
        fromName: campaign.fromName ?? "",
        fromEmail: campaign.fromEmail ?? "",
        replyTo: campaign.replyTo ?? "",
        segmentId: campaign.segmentId ?? "",
        htmlContent: campaign.htmlContent ?? "",
        textContent: campaign.textContent ?? "",
      });
      setSegments(Array.isArray(segs) ? segs : []);
      setLoading(false);
    });
  }, [params.id]);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/campaigns/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        segmentId: form.segmentId || null,
        replyTo: form.replyTo || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Campaign saved");
      router.push(`/campaigns/${params.id}`);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Save failed");
    }
  }

  if (loading) return <div className="p-6 text-gray-400">Loading…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/campaigns/${params.id}`}>
          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Edit Campaign</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Campaign settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Campaign name *" value={form.name} onChange={(e) => set("name", e.target.value)} />
            <div>
              <label className="text-sm font-medium text-gray-700">Audience segment</label>
              <select
                value={form.segmentId}
                onChange={(e) => set("segmentId", e.target.value)}
                className="mt-1 w-full h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">All contacts</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.contactCount})</option>
                ))}
              </select>
            </div>
          </div>
          <Input label="Subject line *" value={form.subject} onChange={(e) => set("subject", e.target.value)} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input label="From name *" value={form.fromName} onChange={(e) => set("fromName", e.target.value)} />
            <Input label="From email *" type="email" value={form.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} />
            <Input label="Reply-to" type="email" value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
          </div>
        </CardContent>
      </Card>

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
            <TiptapEditor value={form.htmlContent} onChange={(html) => set("htmlContent", html)} />
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

      <div className="flex justify-end gap-3 pb-6">
        <Link href={`/campaigns/${params.id}`}>
          <Button variant="outline">Cancel</Button>
        </Link>
        <Button onClick={handleSave} loading={saving}>
          <Save className="w-4 h-4" />
          Save changes
        </Button>
      </div>
    </div>
  );
}
