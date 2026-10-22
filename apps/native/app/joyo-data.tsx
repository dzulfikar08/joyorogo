// Ported from JoyoFit (watch-fit) src/features/ai/ui/DataScreen.tsx, adapted for JoyoRogo.
import "@/unistyles";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { TOOL_NAMES } from "@joyorogo/api/lib/joyo-ai/tools";
import { isLocale, type Locale } from "@joyorogo/i18n";

import {
  Button,
  Card,
  ErrorState,
  PageHeader,
  Screen,
  SectionTitle,
  Skeleton,
  Text,
} from "@/components/ui";
import { previewDigest } from "@/src/lib/joyo-ai/engine";
import { usePerson } from "@/src/lib/joyo-ai/hooks";
import { fmtInt } from "@/utils/format";

/** The digest as it would go with the next question, and what the AI may read while answering. A preview: nothing is sent from here. */
export default function JoyoDataScreen() {
  const { t, i18n } = useTranslation("joyoAiApp");
  const locale: Locale = isLocale(i18n.language) ? i18n.language : "id";
  const person = usePerson();
  const [state, setState] = useState<{ json: string; chars: number } | "loading" | "failed">(
    "loading",
  );

  const [round, setRound] = useState(0);
  useEffect(() => {
    if (person === null) return;
    let cancelled = false;
    previewDigest(person, locale)
      .then(({ digest, json }) => {
        if (!cancelled) setState({ json: JSON.stringify(digest, null, 2), chars: json.length });
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [person, locale, round]);
  const reload = () => {
    setState("loading");
    setRound((n) => n + 1);
  };

  return (
    <Screen>
      <PageHeader title={t("data.screenTitle")} caption={t("data.intro")} />
      {state === "loading" ? <Skeleton width="100%" height={220} radius={24} /> : null}
      {state === "failed" ? <ErrorState message={t("data.failed")} onRetry={reload} /> : null}
      {typeof state === "object" ? (
        <>
          <SectionTitle title={t("data.jsonTitle")} />
          <Card style={styles.stack}>
            <Text style={styles.small}>
              {t("data.size", {
                chars: fmtInt(state.chars),
                tokens: fmtInt(Math.round(state.chars / 4)),
              })}
            </Text>
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.code}
            >
              <Text selectable style={styles.mono}>
                {state.json}
              </Text>
            </ScrollView>
            <Button
              label={t("data.reload")}
              variant="secondary"
              size="sm"
              icon="refresh"
              onPress={reload}
            />
          </Card>
        </>
      ) : null}
      <SectionTitle title={t("data.toolsTitle")} />
      <Card style={styles.stack}>
        <Text style={styles.small}>{t("data.toolsIntro")}</Text>
        <View style={styles.stack}>
          {TOOL_NAMES.map((name) => (
            <Text key={name} style={styles.item}>{`\u2022 ${t(`data.tools.${name}`)}`}</Text>
          ))}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing.md },
  small: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  item: { fontSize: theme.fontSize.sm, lineHeight: 20 },
  code: {
    flexGrow: 0,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.input,
    padding: theme.spacing.md,
  },
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
  },
}));
