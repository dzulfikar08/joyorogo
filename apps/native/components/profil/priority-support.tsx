import "@/unistyles";
import * as Clipboard from "expo-clipboard";
import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { PRIORITY_SUPPORT } from "@joyorogo/i18n";

import { useToast } from "@/components/toast";
import { Button, Card, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/**
 * Pro's priority support: a Threads DM, answered within `PRIORITY_SUPPORT.replyWorkdays` working days. Anyone can DM that
 * account, so the person names the email of their JoyoRogo account, which the owner looks up in the admin; the copy
 * button puts that email on the clipboard. Shown to Pro accounts only: the promise is not made to anyone else.
 */
export function PrioritySupportCard() {
  const { t } = useTranslation("billing");
  const toast = useToast();
  const email = authClient.useSession().data?.user.email ?? null;
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t("pro.support.title")}</Text>
      <Text style={styles.note}>{t("pro.support.how", { count: PRIORITY_SUPPORT.replyWorkdays })}</Text>
      <View style={styles.actions}>
        <Button
          size="sm"
          label={t("pro.support.open")}
          onPress={() => void Linking.openURL(PRIORITY_SUPPORT.threadsUrl)}
        />
        {email ? (
          <Button
            size="sm"
            variant="secondary"
            label={t("pro.support.copyEmail")}
            onPress={() => {
              void Clipboard.setStringAsync(email);
              toast.success(t("pro.support.copied"));
            }}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
}));
