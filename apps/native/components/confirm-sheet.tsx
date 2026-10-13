import { StyleSheet } from "react-native-unistyles";
import { View } from "react-native";

import { Sheet, Button, Text } from "@/components/ui";

/**
 * Styled destructive-action confirmation in the house bottom sheet, standing
 * in for Alert.alert two-button confirms (leave group, remove member, …).
 */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = true,
  loading = false,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  /** Shows a secondary button next to the confirm ("Kembali", "Periksa lagi"). */
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        cancelLabel ? (
          <View style={styles.footerRow}>
            <Button variant="secondary" label={cancelLabel} onPress={onClose} />
            <Button
              label={confirmLabel}
              destructive={destructive}
              loading={loading}
              onPress={onConfirm}
            />
          </View>
        ) : (
          <Button
            label={confirmLabel}
            destructive={destructive}
            loading={loading}
            onPress={onConfirm}
          />
        )
      }
    >
      <Text style={styles.message}>{message}</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  footerRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
}));
