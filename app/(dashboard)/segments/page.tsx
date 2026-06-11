"use client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SegmentForm } from "@/components/segments/segment-form";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Filter, Users } from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";

interface Segment {
  id: string;
  name: string;
  description: string | null;
  filterType: string;
  filterTags: string[];
  manualIds: string[];
  contactLimit: number | null;
  contactCount: number;
  createdAt: string;
}

const FILTER_LABELS: Record<string, string> = {
  all:    "All",
  tags:   "Tag filter",
  manual: "Manual",
};

export default function SegmentsPage() {
  const [segments, setSegments]       = useState<Segment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [editSegment, setEditSegment] = useState<Segment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch("/api/segments");
    const data = await res.json();
    setSegments(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteSegment(id: string) {
    if (!confirm("Delete this segment?")) return;
    const res = await fetch(`/api/segments/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Segment deleted"); load(); }
    else toast.error("Failed to delete");
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Segments</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Group contacts for targeted campaigns
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />
          New segment
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading…</div>
      ) : segments.length === 0 ? (
        <div className="text-center py-20">
          <Filter className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No segments yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Create segments to target specific groups of contacts
          </p>
          <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
            Create first segment
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((seg) => (
            <div
              key={seg.id}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{seg.name}</h3>
                  {seg.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{seg.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => setEditSegment(seg)}
                    className="p-1.5 text-gray-400 hover:text-brand-600 rounded"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteSegment(seg.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {seg.contactCount.toLocaleString()} contacts
                </span>
                <Badge variant="gray" className="text-xs">
                  {FILTER_LABELS[seg.filterType] ?? seg.filterType}
                </Badge>
                {seg.contactLimit && seg.filterType !== "manual" && (
                  <Badge variant="info" className="text-xs">
                    limit {seg.contactLimit.toLocaleString()}
                  </Badge>
                )}
              </div>

              {seg.filterType === "tags" && seg.filterTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {seg.filterTags.map((t) => (
                    <Badge key={t} variant="info">{t}</Badge>
                  ))}
                </div>
              )}

              {seg.filterType === "manual" && (
                <p className="text-xs text-gray-400 mt-3">
                  {seg.manualIds.length.toLocaleString()} contacts hand-picked
                </p>
              )}

              <p className="text-xs text-gray-400 mt-3">
                Created {format(new Date(seg.createdAt), "MMM d, yyyy")}
              </p>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create segment">
        <SegmentForm
          onSuccess={() => { setShowCreate(false); load(); }}
        />
      </Modal>

      <Modal open={!!editSegment} onClose={() => setEditSegment(null)} title="Edit segment">
        {editSegment && (
          <SegmentForm
            initial={{
              id:           editSegment.id,
              name:         editSegment.name,
              description:  editSegment.description ?? "",
              filterType:   editSegment.filterType as "all" | "tags" | "manual",
              filterTags:   editSegment.filterTags,
              manualIds:    editSegment.manualIds,
              contactLimit: editSegment.contactLimit,
            }}
            onSuccess={() => { setEditSegment(null); load(); }}
          />
        )}
      </Modal>
    </div>
  );
}
