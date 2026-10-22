import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { PROVIDERS } from "@joyorogo/api/lib/joyo-ai/providers";
import type { ProviderId } from "@joyorogo/api/lib/joyo-ai/types";

import { Disclosure } from "@/components/disclosure";
import { Text } from "@/components/ui";
import type { AiErrorView, ErrorTarget } from "@/src/lib/joyo-ai/error-view";

import { Notice } from "./notice";
import { useLooseT } from "./use-translate";

/** Opens where an error's next step leads: the key setup, the model picker in settings, the settings, or the provider's key page. */
export function useErrorTarget(provider: ProviderId | null): (target: ErrorTarget) => void {
  const router = useRouter();
  return (target) => {
    if (target === "setup") router.push("/joyo-setup");
    else if (target === "model")
      router.push({ pathname: "/joyo-ai-settings", params: { model: "1" } });
    else if (target === "settings") router.push("/joyo-ai-settings");
    else {
      const url = provider ? PROVIDERS[provider].keyUrl : null;
      if (url) void Linking.openURL(url).catch(() => {});
    }
  };
}

/** A failed provider call: the cause and the one next step as a danger notice, with the kind, HTTP status and the provider's own words collapsed under it. */
export function AiErrorNotice({
  view,
  provider,
}: {
  view: AiErrorView;
  provider: ProviderId | null;
}) {
  const { t } = useTranslation("joyoAiApp");
  const tl = useLooseT();
  const open = useErrorTarget(provider);
  const action = view.action;
  return (
    <View style={styles.wrap}>
      <Notice
        tone="danger"
        action={
          action
            ? { label: t(action.label as "err.action.setup"), onPress: () => open(action.target) }
            : undefined
        }
      >
        {tl(view.message.key, view.message.vars)}
      </Notice>
      {view.kind !== "unknown" && (view.detail || view.status !== null) ? (
        <Disclosure title={t("err.techTitle")} plain>
          <View style={styles.tech}>
            <Text selectable style={styles.small}>
              {t("err.techKind", { kind: view.kind })}
            </Text>
            {view.status !== null ? (
              <Text selectable style={styles.small}>
                {t("err.techStatus", { status: view.status })}
              </Text>
            ) : null}
            {view.detail ? (
              <Text selectable style={styles.small}>
                {t(view.detailFrom === "provider" ? "err.techProvider" : "err.techLine", {
                  text: view.detail,
                })}
              </Text>
            ) : null}
          </View>
        </Disclosure>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.xs },
  tech: { gap: 2 },
  small: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
}));
