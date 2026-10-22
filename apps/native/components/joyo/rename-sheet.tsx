// Ported from JoyoFit (watch-fit) src/features/ai/ui/RenameDialog.tsx, adapted for JoyoRogo.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { CHAT_LIMITS } from "@joyorogo/api/lib/joyo-ai/conversations";

import { Button, Input, Sheet, Text } from "@/components/ui";

/** The full title of a chat, editable. An empty name goes back to the first question. */
export function RenameSheet({
  visible,
  title,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("joyoAiApp");
  const [value, setValue] = useState(title);
  // Each time the sheet opens it starts from the current title (state adjusted while rendering, not in an effect).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setValue(title);
  }
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("chat.renameTitle")}
      footer={<Button label={t("chat.renameSave")} onPress={() => onSave(value)} />}
    >
      <View style={styles.body}>
        <Input
          value={value}
          onChangeText={setValue}
          multiline
          maxLength={CHAT_LIMITS.titleChars}
          accessibilityLabel={t("chat.renameTitle")}
          style={styles.input}
        />
        <Text style={styles.hint}>{t("chat.renameBody")}</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  input: { paddingVertical: 13, textAlignVertical: "top" },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
