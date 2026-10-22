// Ported from JoyoFit (watch-fit) src/features/ai/ui/GateCard.tsx, adapted for JoyoRogo.
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Card, Text } from "@/components/ui";
import { useProOffer } from "@/components/pro/use-pro-offer";
import type { ChatGate } from "@/src/lib/joyo-ai/gate";
import { joyoSettings } from "@/src/lib/joyo-ai/stores";

import { ConsentCard } from "./consent-card";
import { SwitchRow } from "./switch-row";

/** Which engine runs next: the switch is only a setting, nothing is sent by choosing. */
const useEngine = (engine: "hosted" | "byok") => () => void joyoSettings.update({ engine });

/**
 * The chat cannot answer: one card per reason, saying why and giving the one way forward. Nothing is sent while this shows.
 * Under 18 there is no way forward on either engine.
 */
export function GateCard({
  gate,
  ownReady,
  onAgreeHosted,
  onSample,
}: {
  gate: Exclude<ChatGate, { kind: "checking" | "ready" }>;
  ownReady: boolean;
  onAgreeHosted: () => Promise<void>;
  onSample: () => void;
}) {
  const { t } = useTranslation("joyoAiApp");
  const router = useRouter();
  const { canSell } = useProOffer();
  const useOwn = useEngine("byok");
  const useHosted = useEngine("hosted");

  if (gate.kind === "minor") {
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>{t("gate.minor.title")}</Text>
        <Text style={styles.body}>{t("gate.minor.body")}</Text>
      </Card>
    );
  }

  if (gate.kind === "hostedConsent") {
    return <HostedConsent onAgree={onAgreeHosted} onSample={onSample} />;
  }

  if (gate.kind === "paywall" || gate.kind === "unavailable") {
    const paywall = gate.kind === "paywall";
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>
          {t(paywall ? "gate.paywall.title" : "gate.unavailable.title")}
        </Text>
        <Text style={styles.body}>
          {t(paywall ? "gate.paywall.body" : "gate.unavailable.body")}
        </Text>
        {paywall && canSell ? (
          <Button
            label={t("gate.paywall.cta")}
            onPress={() => router.push({ pathname: "/founder", params: { from: "banner" } })}
          />
        ) : null}
        <Button
          label={t(ownReady ? "gate.useOwn" : "gate.ownCta")}
          variant={paywall && canSell ? "secondary" : "primary"}
          icon="key-outline"
          onPress={ownReady ? useOwn : () => router.push("/joyo-setup")}
        />
        <Text style={styles.small}>{t("gate.ownFree")}</Text>
      </Card>
    );
  }

  const reason = gate.reason;
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t(`gate.${reason}.title`)}</Text>
      <Text style={styles.body}>{t(`gate.${reason}.body`)}</Text>
      <Button
        label={t(`gate.${reason}.action`)}
        icon="key-outline"
        onPress={() => router.push("/joyo-setup")}
      />
      <Button label={t("gate.useHosted")} variant="ghost" onPress={useHosted} />
    </Card>
  );
}

/** The one-time yes for the hosted engine: what the server reads and where it goes, plus "18 or older". */
function HostedConsent({
  onAgree,
  onSample,
}: {
  onAgree: () => Promise<void>;
  onSample: () => void;
}) {
  const { t } = useTranslation("joyoAiApp");
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t("gate.hostedConsent.title")}</Text>
      <ConsentCard recipient={t("consent.hostedRecipient")} onSample={onSample} />
      <View>
        <SwitchRow label={t("consent.adult")} value={adult} onValueChange={setAdult} />
        <SwitchRow label={t("consent.agreeHosted")} value={agree} onValueChange={setAgree} />
      </View>
      <Text style={styles.small}>{t("consent.withdrawHosted")}</Text>
      <Button
        label={t("gate.hostedConsent.action")}
        disabled={!adult || !agree}
        loading={busy}
        onPress={() => {
          setBusy(true);
          void onAgree().finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.md },
  title: { fontSize: theme.fontSize.lg, fontWeight: "700" },
  body: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  small: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
}));
