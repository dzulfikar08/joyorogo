import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** In-app confirm sheet for destructive actions (never a browser confirm()). */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  body,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  body: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="space-y-4">
        <p className="text-[0.9375rem] leading-relaxed">{body}</p>
        <div className="flex flex-col gap-2">
          <Button variant="destructive" className="w-full" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("actions.cancel")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
