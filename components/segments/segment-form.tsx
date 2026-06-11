"use client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users } from "lucide-react";
import toast from "react-hot-toast";

interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
}

interface SegmentFormProps {
  initial?: {
    id?: string;
    name?: string;
    description?: string;
    filterType?: "all" | "tags" | "manual";
    filterTags?: string[];
    manualIds?: string[];
    contactLimit?: number | null;
  };
  onSuccess: () => void;
}

const PICKER_PAGE = 20;

export function SegmentForm({ initial, onSuccess }: SegmentFormProps) {
  const [name, setName]               = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [filterType, setFilterType]   = useState<"all" | "tags" | "manual">(
    initial?.filterType ?? "all",
  );
  const [filterTags, setFilterTags]   = useState(initial?.filterTags?.join(", ") ?? "");
  const [contactLimit, setContactLimit] = useState(
    initial?.contactLimit ? String(initial.contactLimit) : "",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initial?.manualIds ?? []),
  );
  const [saving, setSaving] = useState(false);

  // Contact picker state
  const [contacts, setContacts]         = useState<Contact[]>([]);
  const [contactTotal, setContactTotal] = useState(0);
  const [contactPage, setContactPage]   = useState(1);
  const [contactSearch, setContactSearch] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);

  const loadContacts = useCallback(async (page: number, search: string) => {
    setPickerLoading(true);
    try {
      const res  = await fetch(
        `/api/contacts?page=${page}&limit=${PICKER_PAGE}&search=${encodeURIComponent(search)}`,
      );
      const data = await res.json();
      setContacts(data.contacts ?? []);
      setContactTotal(data.total ?? 0);
      setContactPage(page);
    } finally {
      setPickerLoading(false);
    }
  }, []);

  // Load contacts when manual tab first opens
  useEffect(() => {
    if (filterType === "manual") loadContacts(1, "");
  }, [filterType, loadContacts]);

  // Debounce search input
  useEffect(() => {
    if (filterType !== "manual") return;
    const t = setTimeout(() => loadContacts(1, contactSearch), 300);
    return () => clearTimeout(t);
  }, [contactSearch, filterType, loadContacts]);

  function toggleContact(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const allPageSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));

  function togglePage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) contacts.forEach((c) => next.delete(c.id));
      else contacts.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (filterType === "manual" && selectedIds.size === 0) {
      toast.error("Select at least one contact");
      return;
    }
    setSaving(true);

    const payload = {
      name,
      description,
      filterType,
      filterTags: filterType === "tags"
        ? filterTags.split(",").map((t) => t.trim()).filter(Boolean)
        : [],
      manualIds: filterType === "manual" ? Array.from(selectedIds) : [],
      contactLimit:
        filterType !== "manual" && contactLimit ? parseInt(contactLimit, 10) : null,
    };

    const url    = initial?.id ? `/api/segments/${initial.id}` : "/api/segments";
    const method = initial?.id ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      toast.error(err.error ?? "Failed to save segment");
    } else {
      toast.success(initial?.id ? "Segment updated" : "Segment created");
      onSuccess();
    }
    setSaving(false);
  }

  const totalPages = Math.ceil(contactTotal / PICKER_PAGE);

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

      {/* Filter type selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Filter type</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["all",    "All contacts"],
            ["tags",   "By tags"],
            ["manual", "Manual pick"],
          ] as const).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilterType(type)}
              className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                filterType === type
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tag input */}
      {filterType === "tags" && (
        <Input
          label="Tags to include"
          value={filterTags}
          onChange={(e) => setFilterTags(e.target.value)}
          placeholder="newsletter, vip (comma-separated)"
          hint="Contacts with any of these tags will be included"
        />
      )}

      {/* Contact limit — shown for "all" and "tags" only */}
      {filterType !== "manual" && (
        <Input
          label="Contact limit (optional)"
          type="number"
          min="1"
          value={contactLimit}
          onChange={(e) => setContactLimit(e.target.value)}
          placeholder="e.g. 500 — leave empty for no limit"
          hint="Only the first N matching contacts will be included"
        />
      )}

      {/* Manual contact picker */}
      {filterType === "manual" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Pick contacts
            </label>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-600">
              <Users className="w-3.5 h-3.5" />
              {selectedIds.size.toLocaleString()} selected
            </span>
          </div>

          {/* Search */}
          <input
            type="text"
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full h-9 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          {/* List */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            {/* Header row */}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              <span>
                {contactTotal.toLocaleString()} contact{contactTotal !== 1 ? "s" : ""}
                {contactSearch ? " found" : " total"}
              </span>
              {contacts.length > 0 && (
                <button
                  type="button"
                  onClick={togglePage}
                  className="text-brand-600 hover:underline font-medium"
                >
                  {allPageSelected ? "Deselect page" : "Select page"}
                </button>
              )}
            </div>

            {/* Contact rows */}
            <div className="divide-y divide-gray-100 max-h-[260px] overflow-y-auto">
              {pickerLoading ? (
                <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
              ) : contacts.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No contacts found</div>
              ) : (
                contacts.map((c) => {
                  const checked  = selectedIds.has(c.id);
                  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        checked ? "bg-brand-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleContact(c.id)}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {fullName || c.email}
                        </p>
                        {fullName && (
                          <p className="text-xs text-gray-400 truncate">{c.email}</p>
                        )}
                      </div>
                      {c.tags.length > 0 && (
                        <span className="text-xs text-gray-400 shrink-0">
                          {c.tags[0]}{c.tags.length > 1 ? ` +${c.tags.length - 1}` : ""}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 text-xs bg-gray-50">
                <button
                  type="button"
                  disabled={contactPage <= 1 || pickerLoading}
                  onClick={() => loadContacts(contactPage - 1, contactSearch)}
                  className="text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Prev
                </button>
                <span className="text-gray-500">
                  Page {contactPage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={contactPage >= totalPages || pickerLoading}
                  onClick={() => loadContacts(contactPage + 1, contactSearch)}
                  className="text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            )}
          </div>

          {selectedIds.size > 0 && (
            <p className="text-xs text-gray-500">
              {selectedIds.size.toLocaleString()} contacts selected across all pages — they will all receive the campaign regardless of which page you are viewing.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={saving}>
          {initial?.id ? "Save changes" : "Create segment"}
        </Button>
      </div>
    </form>
  );
}
