"use client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { ContactForm } from "@/components/contacts/contact-form";
import { CsvImport } from "@/components/contacts/csv-import";
import {
  Plus,
  Search,
  Upload,
  Download,
  Trash2,
  Pencil,
  Users,
  AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";

interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  subscribedAt: string;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendLimit, setSendLimit] = useState<number>(300);
  const PER_PAGE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PER_PAGE.toString(),
      ...(search && { search }),
    });
    const res = await fetch(`/api/contacts?${params}`);
    const data = await res.json();
    setContacts(data.contacts ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { if (d.dailySendLimit) setSendLimit(d.dailySendLimit); })
      .catch(() => {});
  }, []);

  async function deleteContact(id: string) {
    if (!confirm("Delete this contact?")) return;
    const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Contact deleted");
      load();
    } else {
      toast.error("Failed to delete");
    }
  }

  async function deleteBulk() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected contacts?`)) return;
    await Promise.all(
      Array.from(selected).map((id) =>
        fetch(`/api/contacts/${id}`, { method: "DELETE" }),
      ),
    );
    toast.success(`Deleted ${selected.size} contacts`);
    setSelected(new Set());
    load();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === contacts.length
        ? new Set()
        : new Set(contacts.map((c) => c.id)),
    );
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total.toLocaleString()} total contacts
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("/api/contacts/export", "_blank")}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowImport(true)}
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" />
            Add contact
          </Button>
        </div>
      </div>

      {/* Brevo daily limit warning */}
      {total > sendLimit && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <div>
            <span className="font-semibold">Brevo daily send limit: {sendLimit.toLocaleString()} emails/day.</span>{" "}
            Your database has <span className="font-semibold">{total.toLocaleString()}</span> contacts — only the first{" "}
            <span className="font-semibold">{sendLimit.toLocaleString()}</span> will be reached per campaign send.
            Use <span className="font-semibold">Segments</span> to target a specific subset, or upgrade your Brevo plan and update the limit in{" "}
            <a href="/settings" className="underline font-semibold hover:text-amber-900">Settings</a>.
          </div>
        </div>
      )}

      {/* Search + bulk actions */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {selected.size > 0 && (
          <Button variant="danger" size="sm" onClick={deleteBulk}>
            <Trash2 className="w-4 h-4" />
            Delete {selected.size} selected
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="w-10 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={
                    contacts.length > 0 &&
                    selected.size === contacts.length
                  }
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Email
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Name
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Tags
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Added
              </th>
              <th className="w-20 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500">No contacts found</p>
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {c.email}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="gray">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {format(new Date(c.subscribedAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditContact(c)}
                        className="p-1.5 text-gray-400 hover:text-brand-600 rounded"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteContact(c.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50 text-sm">
            <span className="text-gray-500">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add contact"
      >
        <ContactForm
          onSuccess={() => {
            setShowAdd(false);
            load();
          }}
        />
      </Modal>

      <Modal
        open={!!editContact}
        onClose={() => setEditContact(null)}
        title="Edit contact"
      >
        {editContact && (
          <ContactForm
            initial={{
              id: editContact.id,
              email: editContact.email,
              firstName: editContact.firstName ?? "",
              lastName: editContact.lastName ?? "",
              tags: editContact.tags.join(", "),
            }}
            onSuccess={() => {
              setEditContact(null);
              load();
            }}
          />
        )}
      </Modal>

      <Modal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import contacts from CSV"
        description="Upload a CSV with columns: email, firstName, lastName, tags"
        className="max-w-2xl"
      >
        <CsvImport
          onSuccess={() => {
            setShowImport(false);
            load();
          }}
        />
      </Modal>
    </div>
  );
}
