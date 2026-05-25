"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

interface SegmentFormProps {
  initial?: {
    id?: string;
    name?: string;
    description?: string;
    filterType?: "all" | "tags";
    filterTags?: string[];
  };
  onSuccess: () => void;
}

export function SegmentForm({ initial, onSuccess }: SegmentFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [filterType, setFilterType] = useState<"all" | "tags">(
    initial?.filterType ?? "all",
  );
  const [filterTags, setFilterTags] = useState(
    initial?.filterTags?.join(", ") ?? "",
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      name,
      description,
      filterType,
      filterTags: filterTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    const url = initial?.id ? `/api/segments/${initial.id}` : "/api/segments";
    const method = initial?.id ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to save segment");
    } else {
      toast.success(initial?.id ? "Segment updated" : "Segment created");
      onSuccess();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Segment name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. VIP Customers"
        required
      />
      <Input
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional description"
      />

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Filter type</label>
        <div className="grid grid-cols-2 gap-2">
          {(["all", "tags"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilterType(type)}
              className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                filterType === type
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
              }`}
            >
              {type === "all" ? "All contacts" : "Filter by tags"}
            </button>
          ))}
        </div>
      </div>

      {filterType === "tags" && (
        <Input
          label="Tags to include"
          value={filterTags}
          onChange={(e) => setFilterTags(e.target.value)}
          placeholder="newsletter, vip (comma-separated)"
          hint="Contacts with any of these tags will be included"
        />
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={loading}>
          {initial?.id ? "Save changes" : "Create segment"}
        </Button>
      </div>
    </form>
  );
}
