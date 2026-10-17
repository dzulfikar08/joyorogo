import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "./api";

/** Deliverability check: the server mails a test message to the signed-in admin. */
export function useSendTestEmail() {
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      const res = await api<{ outcome: string }>("/api/admin/test-email", { method: "POST" });
      if (res.outcome === "sent") toast.success(res.outcome);
      else toast.error(res.outcome);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };
  return { sending, send };
}
