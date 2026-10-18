import { DEFAULT_ADD_BACK_SETTINGS } from "@joyorogo/api/lib/exercise-credit";
import { Button } from "@joyorogo/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { Flame, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { useSession } from "@/lib/auth-client";
import { dismissalStoreKey, saveDismissal } from "@/lib/dismissals";

/**
 * One-time notice that Sisa now adds recorded exercise back. The server says whether the account is old enough
 * (`show`); the closing is kept per account (rogo-prefs.ts) and hides it at once.
 */
export function AddBackNotice({ show, className }: { show: boolean; className?: string }) {
  const { t } = useTranslation(["home", "common"]);
  const navigate = useNavigate();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!userId) return;
    try {
      setDismissed(localStorage.getItem(dismissalStoreKey("dismissed.addBackNotice", userId)) === "1");
    } catch {
      // Storage blocked (private mode): treat as seen rather than nagging every visit.
      setDismissed(true);
    }
  }, [userId]);

  if (!show || dismissed) return null;

  const dismiss = () => {
    // Without storage the state below still hides it for this visit.
    if (userId) saveDismissal("dismissed.addBackNotice", userId);
    setDismissed(true);
  };

  return (
    <Card className={className} aria-label={t("home:addBackNotice.title")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flame className="size-5 text-bakar" aria-hidden />
          <h2 className="text-base font-bold">{t("home:addBackNotice.title")}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("home:addBackNotice.dismiss")} onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t("home:addBackNotice.body", { pct: DEFAULT_ADD_BACK_SETTINGS.pct })}
      </p>
      <div className="mt-3">
        <Button
          size="sm"
          className="min-h-11"
          onClick={() => {
            void navigate({ to: "/profil/target", search: {} });
          }}
        >
          {t("home:addBackNotice.action")}
        </Button>
      </div>
    </Card>
  );
}
