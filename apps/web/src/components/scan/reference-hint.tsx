import { useQuery } from "@tanstack/react-query";
import { Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { orpc } from "@/utils/orpc";

// Closed on this browser for good; not tied to the account (the tip is about a habit with the camera).
const STORE_KEY = "jrg-scan-reference-hint";

function readClosed(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false;
  }
}

/** One line on the scan screen: put a card or a kitchen scale beside the food (the scale only where no card is read). */
export function ReferenceHint() {
  const { t } = useTranslation("scan");
  const hint = useQuery(orpc.dishware.scanHint.queryOptions());
  const [closed, setClosed] = useState(readClosed);
  if (!hint.data || !(hint.data.show || hint.data.scale) || closed) return null;
  return (
    <p className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded-2xl bg-muted px-3.5 py-1.5 text-left text-xs text-muted-foreground">
      <Lightbulb className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{t(hint.data.show ? "idle.referenceHint" : "idle.referenceHintScale")}</span>
      <button
        type="button"
        aria-label={t("idle.referenceHintClose")}
        className="-my-0.5 -mr-1.5 shrink-0 rounded-full p-1 hover:bg-background/60"
        onClick={() => {
          setClosed(true);
          try {
            localStorage.setItem(STORE_KEY, "1");
          } catch {
            // Storage blocked: the tip only comes back.
          }
        }}
      >
        <X className="size-3" aria-hidden />
      </button>
    </p>
  );
}
