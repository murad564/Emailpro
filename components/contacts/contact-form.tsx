"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

interface ContactFormData {
  email: string;
  firstName: string;
  lastName: string;
  tags: string;
}

interface ContactFormProps {
  initial?: Partial<ContactFormData> & { id?: string };
  onSuccess: () => void;
}

export function ContactForm({ initial, onSuccess }: ContactFormProps) {
  const [form, setForm] = useState<ContactFormData>({
    email: initial?.email ?? "",
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    tags: initial?.tags ?? "",
  });
  const [loading, setLoading] = useState(false);

  function set(field: keyof ContactFormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      ...form,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    const url = initial?.id ? `/api/contacts/${initial.id}` : "/api/contacts";
    const method = initial?.id ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      toast.error(err.error ?? "Failed to save contact");
    } else {
      toast.success(initial?.id ? "Contact updated" : "Contact created");
      onSuccess();
    }

    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Email address *"
        type="email"
        value={form.email}
        onChange={(e) => set("email", e.target.value)}
        placeholder="contact@example.com"
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="First name"
          value={form.firstName}
          onChange={(e) => set("firstName", e.target.value)}
          placeholder="Jane"
        />
        <Input
          label="Last name"
          value={form.lastName}
          onChange={(e) => set("lastName", e.target.value)}
          placeholder="Smith"
        />
      </div>
      <Input
        label="Tags"
        value={form.tags}
        onChange={(e) => set("tags", e.target.value)}
        placeholder="newsletter, vip, en (comma-separated)"
        hint="Separate multiple tags with commas"
      />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="submit" loading={loading}>
          {initial?.id ? "Save changes" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}
