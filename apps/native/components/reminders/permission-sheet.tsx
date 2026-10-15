import { useRef, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Mascot } from "@/components/mascot";
import { Button, Sheet, Text } from "@/components/ui";
import {
  getNotificationPermission,
  openNotificationSettings,
  requestNotificationPermission,
} from "@/src/lib/notifications";

type Mode = "ask" | "blocked";

/**
 * Notification permission behind a styled pre-prompt. Android 13+ and iOS show
 * the system dialog once, so it only appears after the user agrees here
 * (a "Nanti saja" costs nothing). When the system already blocked the dialog,
 * the sheet points to Settings instead of pretending a prompt will show.
 *
 * `ensure()` resolves true when reminders may be scheduled. Render `sheet`
 * anywhere in the screen's tree.
 */
export function useNotificationGate() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<PromiseWithResolvers<boolean> | null>(null);

  const settle = (granted: boolean) => {
    setMode(null);
    setBusy(false);
    pending.current?.resolve(granted);
    pending.current = null;
  };

  const ensure = async (): Promise<boolean> => {
    const permission = await getNotificationPermission();
    if (permission === "granted") return true;
    pending.current?.resolve(false);
    pending.current = Promise.withResolvers<boolean>();
    const decision = pending.current.promise;
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
      title={mode === "blocked" ? "Notifikasi dimatikan" : "Izinkan pengingat?"}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label="Nanti saja" onPress={() => settle(false)} />
          {mode === "blocked" ? (
            <Button label="Buka Pengaturan" onPress={() => void openSettings()} />
          ) : (
            <Button label="Izinkan" loading={busy} onPress={() => void allow()} />
          )}
        </View>
      }
    >
      <View style={styles.mascot}>
        <Mascot pose="ready" size="sm" />
      </View>
      <Text style={styles.message}>
        {mode === "blocked"
          ? "Android atau iOS tidak lagi menampilkan permintaan izin untuk JoyoRogo. Nyalakan notifikasi JoyoRogo di Pengaturan, lalu kembali ke sini dan aktifkan pengingatnya lagi."
          : "JoyoRogo mengirim pengingat catat makan, minum, timbang, dan jendela puasa di jam yang kamu pilih. Notifikasi hanya untuk itu, tidak ada iklan. Setelah ini sistem akan meminta izin sekali."}
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
