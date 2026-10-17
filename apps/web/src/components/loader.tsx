import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Mascot } from "@/components/mascot";

/** Router-level pending fallback: a quiet spinner on the paper canvas. */
export default function Loader() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center gap-4"
      role="status"
      aria-label={t("state.loading")}
    >
      <Mascot pose="working" size="md" eager />
      <Loader2
        className="size-6 animate-spin text-muted-foreground motion-reduce:animate-[spin_1.5s_linear_infinite]"
        aria-hidden
      />
    </div>
  );
}
