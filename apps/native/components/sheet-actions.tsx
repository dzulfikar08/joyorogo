import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button } from "@/components/ui";

/**
 * Secondary actions at the bottom of the diary edit sheets: Favorit toggle,
 * share, ask Joyo AI and delete. Share, ask and delete are optional (a plate has none of them).
 */
export function SheetActions({
  favorite,
  onFavorite,
  onShare,
  onDelete,
  ask,
}: {
  favorite: boolean;
  onFavorite: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  /** The "Tanya Joyo AI" action of a logged food (see components/joyo/ask-button). */
  ask?: React.ReactNode;
}) {
  const { t } = useTranslation(["makan", "common"]);
  return (
    <View style={styles.row}>
      <Button
        variant="secondary"
        size="sm"
        icon={favorite ? "star" : "star-outline"}
        label={favorite ? t("sheetActions.removeFavorite") : t("sheetActions.addFavorite")}
        onPress={onFavorite}
      />
      {onShare ? (
        <Button
          variant="secondary"
          size="sm"
          icon="share-social-outline"
          label={t("sheetActions.share")}
          onPress={onShare}
        />
      ) : null}
      {ask}
      {onDelete ? (
        <Button
          variant="secondary"
          size="sm"
          icon="trash-outline"
          label={t("common:actions.delete")}
          destructive
          onPress={onDelete}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
}));
