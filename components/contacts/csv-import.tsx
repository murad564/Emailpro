"use client";
import { useState, useRef } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Upload, FileText, CheckCircle, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function CsvImport({ onSuccess }: { onSuccess: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(res) {
        setPreview(res.data.slice(0, 3));
      },
    });
  }

  async function handleImport() {
    if (!fileRef.current?.files?.[0]) return;
    setLoading(true);

    const formData = new FormData();
    formData.append("file", fileRef.current.files[0]);

    const res = await fetch("/api/contacts/import", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Import failed");
    } else {
      setResult(data);
      toast.success(`Imported ${data.imported} contacts`);
      onSuccess();
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
          fileName
            ? "border-brand-400 bg-brand-50"
            : "border-gray-300 hover:border-brand-400 hover:bg-gray-50",
        )}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {fileName ? (
          <>
            <FileText className="w-8 h-8 text-brand-500 mx-auto mb-2" />
            <p className="font-medium text-gray-900">{fileName}</p>
            <p className="text-xs text-gray-500 mt-1">Click to change file</p>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="font-medium text-gray-700">Drop a CSV file or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">
              Required column: <code>email</code> — Optional:{" "}
              <code>firstName</code>, <code>lastName</code>, <code>tags</code>
            </p>
          </>
        )}
      </div>

      {preview.length > 0 && (
        <div className="text-xs overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {Object.keys(preview[0]).map((k) => (
                  <th
                    key={k}
                    className="px-3 py-2 text-left font-medium text-gray-500"
                  >
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-t border-gray-100">
                  {Object.values(row).map((v, j) => (
                    <td key={j} className="px-3 py-2 text-gray-700">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-gray-400">Preview (first 3 rows)</p>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-gray-200 p-4 text-sm space-y-1">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="w-4 h-4" />
            {result.imported} contacts imported
          </div>
          {result.skipped > 0 && (
            <div className="flex items-center gap-2 text-yellow-700">
              <XCircle className="w-4 h-4" />
              {result.skipped} skipped (duplicates / invalid)
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleImport}
          disabled={!fileName}
          loading={loading}
        >
          Import contacts
        </Button>
      </div>
    </div>
  );
}
