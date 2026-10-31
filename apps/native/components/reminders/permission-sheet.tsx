import { useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { Mascot } from "@/components/mascot";
import { Button, Sheet, Text } from "@/components/ui";
import {
  getNotificationPermission,
  openNotificationSettings,
  requestNotificationPermission,
} from "@/src/lib/notifications";

type Mode = "ask" | "blocked";

/** Which feature asks; picks the pre-prompt wording. Default: the reminder copy. */
export type GateReason = "meal" | "social";

/**
 * Notification permission behind a styled pre-prompt. Android 13+ and iOS show
 * the system dialog once, so it only appears after the user agrees here
 * (a "Not now" costs nothing). When the system already blocked the dialog,
 * the sheet points to Settings instead of pretending a prompt will show.
 *
 * `ensure()` resolves true when reminders may be scheduled. Render `sheet`
 * anywhere in the screen's tree.
 */
export function useNotificationGate() {
  const { t } = useTranslation("settings");
  const { t: tn } = useTranslation("notifications");
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState<GateReason | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<PromiseWithResolvers<boolean> | null>(null);

  const settle = (granted: boolean) => {
    setMode(null);
    setBusy(false);
    pending.current?.resolve(granted);
    pending.current = null;
  };

  const ensure = async (why?: GateReason): Promise<boolean> => {
    const permission = await getNotificationPermission();
    if (permission === "granted") return true;
    pending.current?.resolve(false);
    pending.current = Promise.withResolvers<boolean>();
    const decision = pending.current.promise;
    setReason(why ?? null);
    setMode(permission === "blocked" ? "blocked" : "ask");
    return decision;
  };

  const allow = async () => {
    setBusy(true);
    settle(await requestNotificationPermission());
  };

  const openSettings = async () => {
    await openNotificationSettings();
    settle(false);
  };

  const sheet = (
    <Sheet
      visible={mode !== null}
      onClose={() => settle(false)}
      title={
        mode === "blocked"
          ? t("reminders.permission.blockedTitle")
          : reason
            ? tn(`native.ask.${reason}Title`)
            : t("reminders.permission.askTitle")
      }
      footer={
        <View style={styles.footer}>
          <Button
            variant="secondary"
            label={t("reminders.permission.later")}
            onPress={() => settle(false)}
          />
          {mode === "blocked" ? (
            <Button
              label={t("reminders.permission.openSettings")}
              onPress={() => void openSettings()}
            />
          ) : (
            <Button
              label={t("reminders.permission.allow")}
              loading={busy}
              onPress={() => void allow()}
            />
          )}
        </View>
      }
    >
      <View style={styles.mascot}>
        <Mascot pose="ready" size="sm" />
      </View>
      <Text style={styles.message}>
        {mode === "blocked"
          ? t("reminders.permission.blockedMessage")
          : reason
            ? tn(`native.ask.${reason}Message`)
            : t("reminders.permission.askMessage")}
      </Text>
    </Sheet>
  );

  return { ensure, sheet };
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  mascot: {
    alignItems: "center",
  },
  message: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
    lineHeight: 22,
  },
}));
