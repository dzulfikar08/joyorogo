// Ported from JoyoFit (watch-fit) src/features/ai/ui/ConsentCard.tsx, adapted for JoyoRogo.
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { CONSENT_CATEGORIES } from "@joyorogo/api/lib/joyo-ai/consent";

import { Button, Text } from "@/components/ui";

interface ConsentCardProps {
  /** Who receives it, already worded ("OpenRouter (openrouter.ai)" or "server JoyoRogo"). */
  recipient: string;
  /** The provider's own terms line applies to the own-key engine only. */
  termsProvider?: string;
  onSample: () => void;
}

/**
 * What the person agrees to before anything is sent (Apple 5.1.2(i), Google Play's AI user-data rules): who gets the data, every kind
 * of data that leaves the phone, what never does. The categories are `CONSENT_CATEGORIES`, so a change to the digest (and its
 * `CONSENT_VERSION`) shows up here.
 */
export function ConsentCard({ recipient, termsProvider, onSample }: ConsentCardProps) {
  const { t } = useTranslation("joyoAiApp");
  return (
    <View style={styles.wrap}>
      <Text style={styles.strong}>{t("consent.to", { recipient })}</Text>
      <Text style={styles.small}>{t("consent.lead")}</Text>
      <View style={styles.list}>
        {CONSENT_CATEGORIES.map((id) => (
          <Text key={id} style={styles.item}>
            {`\u2022 ${t(`consent.data.${id}`)}`}
          </Text>
        ))}
      </View>
      <Text style={styles.strong}>{t("consent.notSentTitle")}</Text>
      <Text style={styles.small}>{t("consent.notSent")}</Text>
      {termsProvider ? (
        <Text style={styles.small}>{t("consent.terms", { provider: termsProvider })}</Text>
      ) : (
        <Text style={styles.small}>{t("consent.hostedKept")}</Text>
      )}
      <Button
        label={t("consent.sample")}
        variant="ghost"
        size="sm"
        icon="eye-outline"
        onPress={onSample}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.sm },
  list: { gap: theme.spacing.xs },
  strong: { fontSize: theme.fontSize.base, fontWeight: "700" },
  item: { fontSize: theme.fontSize.sm, lineHeight: 20 },
  small: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
}));
