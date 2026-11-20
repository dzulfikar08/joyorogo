import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Button, Text } from "@/components/ui";

/** analyzeFood takes a hint of at most 200 characters. */
const MAX_CHARS = 200;

/**
 * "Tulis keterangan" on the camera screen: for food the user already knows is hard to tell apart (siomay or batagor,
 * egg white in a bag), the words go into the first scan's prompt instead of a correction afterwards. The editor is a
 * card at the top of the screen, so the keyboard never covers it; the pill then shows what will be sent, with a clear.
 */
export function DescribePhoto({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(["scan", "common"]);
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const open = () => {
    setDraft(value);
    setEditing(true);
  };
  const close = () => {
    onChange(draft.trim());
    setEditing(false);
  };

  return (
    <>
      <View style={styles.pillRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={value ? t("describe.editLabel", { text: value }) : t("describe.open")}
          disabled={disabled}
          onPress={open}
          dimTo={0.7}
          style={[styles.pill, value ? styles.pillSet : null, disabled && styles.disabled]}
        >
          <Ionicons name="create-outline" size={18} color="#FFFFFF" />
          <Text style={styles.pillText} numberOfLines={1}>
            {value ? t("describe.set", { text: value }) : t("describe.open")}
          </Text>
        </PressableScale>
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("describe.clear")}
            onPress={() => onChange("")}
            hitSlop={10}
            style={styles.clear}
          >
            <Ionicons name="close" size={18} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>
      <Modal visible={editing} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <Pressable accessibilityLabel={t("common:actions.close")} onPress={close} style={styles.backdrop}>
          <Pressable
            onPress={() => {}}
            style={[styles.card, { marginTop: insets.top + theme.spacing.lg }]}
            accessible={false}
          >
            <Text style={styles.title}>{t("describe.title")}</Text>
            <Text style={styles.body}>{t("describe.body")}</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              multiline
              maxLength={MAX_CHARS}
              placeholder={t("describe.placeholder")}
              placeholderTextColor={theme.colors.mutedForeground}
              accessibilityLabel={t("describe.title")}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={close}
              style={styles.input}
            />
            <Button label={t("describe.done")} onPress={close} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    maxWidth: "100%",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    maxWidth: 280,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  pillSet: {
    backgroundColor: theme.colors.primary,
  },
  pillText: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  clear: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  disabled: {
    opacity: 0.5,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: theme.spacing.lg,
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 560,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.card,
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  input: {
    minHeight: 72,
    padding: theme.spacing.md,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlignVertical: "top",
  },
}));
