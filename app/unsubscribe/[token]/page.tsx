"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Mail, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function UnsubscribePage() {
  const params = useParams();
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [email, setEmail] = useState("");

  async function handleUnsubscribe() {
    setStatus("loading");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params.token }),
      });
      const data = await res.json();
      if (res.ok) {
        setEmail(data.email);
        setStatus("done");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        {status === "done" ? (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              You&apos;ve been unsubscribed
            </h1>
            <p className="text-sm text-gray-500">
              <strong>{email}</strong> has been removed from our mailing list.
              You won&apos;t receive any more emails from this sender.
            </p>
            <p className="text-xs text-gray-400 mt-4">
              Changed your mind? Contact us to re-subscribe.
            </p>
          </>
        ) : status === "error" ? (
          <>
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Invalid unsubscribe link
            </h1>
            <p className="text-sm text-gray-500">
              This unsubscribe link is invalid or has already been used.
            </p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-6 h-6 text-brand-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Unsubscribe
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to unsubscribe from this mailing list?
              You won&apos;t receive future emails from this sender.
            </p>
            <Button
              onClick={handleUnsubscribe}
              loading={status === "loading"}
              variant="danger"
              className="w-full"
            >
              Yes, unsubscribe me
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
