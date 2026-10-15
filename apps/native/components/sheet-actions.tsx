import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button } from "@/components/ui";

/**
 * Secondary actions at the bottom of the diary edit sheets: Favorit toggle,
 * share and delete. Share and delete are optional (a plate has neither).
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
  return (
    <View style={styles.row}>
      <Button
        variant="secondary"
        size="sm"
        icon={favorite ? "star" : "star-outline"}
        label={favorite ? "Hapus dari Favorit" : "Simpan ke Favorit"}
        onPress={onFavorite}
      />
      {onShare ? (
        <Button
          variant="secondary"
          size="sm"
          icon="share-social-outline"
          label="Bagikan"
          onPress={onShare}
        />
      ) : null}
      {onDelete ? (
        <Button
          variant="secondary"
          size="sm"
          icon="trash-outline"
          label="Hapus"
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
