import { Button } from "@joyorogo/ui/components/button";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "./surface";

/** Error state for a screen or section: says what failed, offers one retry. */
export function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation(["misc", "common"]);
  return (
    <Card role="alert">
      <span className="flex size-9 items-center justify-center rounded-full bg-destructive/10">
        <CircleAlert className="size-[1.125rem] text-destructive" aria-hidden />
      </span>
      <p className="mt-3 text-[0.9375rem] font-bold">{t("misc:state.loadFailedData")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
        {t("common:actions.retry")}
      </Button>
    </Card>
  );
}
