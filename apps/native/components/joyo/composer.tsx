// Ported from JoyoFit (watch-fit) src/features/ai/ui/Composer.tsx, adapted for JoyoRogo.
import { Ionicons } from "@expo/vector-icons";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Input, Text } from "@/components/ui";

import { IconButton } from "./icon-button";

/** The box grows to about five lines and then scrolls. */
const MAX_FIELD_HEIGHT = 22 * 5 + 26;

interface ComposerProps {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Stops the answer being written; shown in place of send while `sending`. */
  onStop: () => void;
  sending: boolean;
  /** The person is rewriting an earlier question: a bar says so and can cancel. */
  editing: boolean;
  onCancelEdit: () => void;
  maxLength: number;
  inputRef: RefObject<TextInput | null>;
}

/**
 * The composer: the editing bar, the multiline box with send (Stop while answering), and the standing line under it. The screen's
 * footer already clears the keyboard and the gesture bar, so nothing here adds a bottom inset of its own.
 */
export function Composer({
  text,
  onChangeText,
  onSend,
  onStop,
  sending,
  editing,
  onCancelEdit,
  maxLength,
  inputRef,
}: ComposerProps) {
  const { t } = useTranslation("joyoAiApp");
  const { t: tj } = useTranslation("joyoAi");
  const { theme } = useUnistyles();
  return (
    <View style={styles.footer}>
      {editing ? (
        <View style={styles.editing}>
          <Ionicons name="create-outline" size={16} color={theme.colors.mutedForeground} />
          <Text style={styles.editingText}>{t("chat.editing")}</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("chat.editCancel")}
            onPress={onCancelEdit}
            scaleTo={0.92}
            style={styles.editingCancel}
          >
            <Ionicons name="close" size={18} color={theme.colors.mutedForeground} />
          </PressableScale>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <View style={styles.grow}>
          <Input
            ref={inputRef}
            value={text}
            onChangeText={onChangeText}
            placeholder={t("chat.placeholder")}
            multiline
            maxLength={maxLength}
            accessibilityLabel={t("chat.placeholder")}
            style={styles.field}
          />
        </View>
        {sending ? (
          <IconButton icon="stop" label={t("chat.stop")} onPress={onStop} tone="foreground" />
        ) : (
          <IconButton
            icon="arrow-up"
            label={t("chat.send")}
            onPress={onSend}
            disabled={text.trim().length === 0}
            filled
          />
        )}
      </View>
      <Text style={styles.standing} numberOfLines={2}>
        {tj("disclaimerLine")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.xs,
    "@md": { width: "100%", maxWidth: 640 },
  },
  editing: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  editingText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  editingCancel: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -theme.spacing.sm,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: theme.spacing.sm },
  grow: { flex: 1 },
  field: { maxHeight: MAX_FIELD_HEIGHT, paddingVertical: 13, textAlignVertical: "center" },
  standing: {
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    color: theme.colors.mutedForeground,
  },
}));
