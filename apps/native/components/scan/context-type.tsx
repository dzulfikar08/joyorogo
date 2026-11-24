import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { CorrectInput } from "./correct-box";

/** correctScan takes text of at least 2 characters. */
const MIN_CHARS = 2;
const MAX_CHARS = 200;

/**
 * The typed twin of the analyzing screen's mic: what the user types while the photo is analyzed is queued the same
 * way (one slot, the latest wins) and applied as a correction once the rows arrive. Prod before this: 334 of 336
 * corrections were typed, almost all after the result was already on screen.
 *
 * While the field has focus and text in it, `onActive(true)` holds the result back (as a take being spoken does),
 * so a half-typed line is never lost when the scan finishes. Blurring with text in it queues it.
 */
export function ContextType({
  queued,
  onQueue,
  onActive,
}: {
  queued: CorrectInput | null;
  onQueue: (input: CorrectInput) => unknown;
  onActive: (active: boolean) => void;
}) {
  const { t } = useTranslation("scan");
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const typing = focused && draft.trim().length > 0;

  useEffect(() => {
    onActive(typing);
  }, [typing, onActive]);
  useEffect(() => () => onActive(false), [onActive]);

  const send = () => {
    const text = draft.trim();
    if (text.length < MIN_CHARS) return;
    onQueue({ text });
    setDraft("");
  };

  // Something is already queued (typed or spoken): the mic's queued line shows it with its remove button.
  if (queued) return null;

  const canSend = draft.trim().length >= MIN_CHARS;
  return (
    <View style={styles.row}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          send();
        }}
        onSubmitEditing={send}
        placeholder={t("analyzing.contextTypePlaceholder")}
        placeholderTextColor="rgba(255,255,255,0.6)"
        accessibilityLabel={t("analyzing.contextTypeLabel")}
        returnKeyType="send"
        submitBehavior="blurAndSubmit"
        maxLength={MAX_CHARS}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("analyzing.contextTypeSend")}
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={send}
        hitSlop={8}
        style={[styles.send, !canSend && styles.sendDisabled]}
      >
        <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    alignSelf: "stretch",
  },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
    color: "#FFFFFF",
    fontSize: theme.fontSize.base,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  sendDisabled: {
    opacity: 0.4,
  },
}));
