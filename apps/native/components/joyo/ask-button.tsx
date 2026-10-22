import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Button } from "@/components/ui";
import type { AskT } from "@/src/lib/joyo-ai/ask";
import { useJoyoDestination } from "@/src/lib/joyo-ai/hooks";

/** How long a sheet's close animation is given before the chat opens over it (a native modal still leaving blocks a push). */
const SHEET_CLOSE_MS = 320;

/** `t` of the question templates (`joyoAiApp:ask.*`) in the shape the pure builders in `src/lib/joyo-ai/ask.ts` take. */
export function useAskT(): AskT {
  const { t } = useTranslation("joyoAiApp");
  return t as unknown as AskT;
}

/** Opens Joyo AI (or its setup when there is nothing to answer yet), with an unsent question typed into a new chat when `ask` is given. */
export function useOpenJoyo(ask?: string | null): () => void {
  const destination = useJoyoDestination(ask ? { text: ask } : null);
  return () => router.push(destination);
}

/**
 * The round "Tanya Joyo AI" button of a page header (Beranda, Makan): the sparkle is the owner's choice for this entry point and the
 * only one in the app; every other entry point is a plain text action.
 */
export function AskJoyoHeaderButton() {
  const { t } = useTranslation("joyoAiApp");
  const { theme } = useUnistyles();
  const open = useOpenJoyo();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("ask.header")}
      onPress={open}
      dimTo={0.75}
      scaleTo={0.94}
      style={styles.round}
    >
      <Ionicons name="sparkles-outline" size={22} color={theme.colors.foreground} />
    </PressableScale>
  );
}

/**
 * "Tanya Joyo AI" on a food (the portion sheet) or a scan result ("mau makan ini? tanya dulu"): a new chat with `question` typed in,
 * not sent. `beforeOpen` closes whatever sheet this sits in.
 */
export function AskJoyoAction({
  question,
  kind,
  beforeOpen,
}: {
  question: string | null;
  kind: "food" | "scan";
  beforeOpen?: () => void;
}) {
  const { t } = useTranslation("joyoAiApp");
  const open = useOpenJoyo(question);
  if (question === null) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="chatbubble-ellipses-outline"
      label={kind === "scan" ? t("ask.scanAction") : t("ask.foodAction")}
      onPress={() => {
        if (!beforeOpen) return open();
        beforeOpen();
        setTimeout(open, SHEET_CLOSE_MS);
      }}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  round: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
}));
