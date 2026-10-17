import { Button } from "@joyorogo/ui/components/button";
import { Share2, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Secondary actions at the bottom of the diary edit sheets: Favorit toggle,
 * share and delete. Each one is optional so the plate sheet can offer only
 * what a plate supports.
 */
export function SheetActions({
  favorite,
  onFavorite,
  onShare,
  onDelete,
}: {
  favorite: boolean;
  onFavorite: () => void;
  onShare?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation(["makan", "common"]);
  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={favorite}
        onClick={onFavorite}
        className={favorite ? "text-makan-ink" : undefined}
      >
        <Star className={favorite ? "fill-current" : undefined} aria-hidden />
        {favorite ? t("sheetActions.removeFavorite") : t("sheetActions.addFavorite")}
      </Button>
      {onShare && (
        <Button type="button" variant="outline" size="sm" onClick={onShare}>
          <Share2 aria-hidden />
          {t("sheetActions.share")}
        </Button>
      )}
      {onDelete && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 aria-hidden />
          {t("common:actions.delete")}
        </Button>
      )}
    </div>
  );
}
