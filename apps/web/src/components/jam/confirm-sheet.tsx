import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useTranslation } from "react-i18next";

/** Destructive confirmation in the repo's dialog form: a bottom sheet with Batal and one red action. */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <div className="flex gap-2">
        <Button variant="destructive" className="flex-1" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="ghost" className="flex-1" disabled={pending} onClick={() => onOpenChange(false)}>
          {t("actions.cancel")}
        </Button>
      </div>
    </Sheet>
  );
}
