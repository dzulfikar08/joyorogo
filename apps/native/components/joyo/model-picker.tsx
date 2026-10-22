// Ported from JoyoFit (watch-fit) src/features/ai/ui/ModelPicker.tsx, adapted for JoyoRogo.
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { searchModels } from "@joyorogo/api/lib/joyo-ai/models";
import { PROVIDERS } from "@joyorogo/api/lib/joyo-ai/providers";
import type { ModelInfo, ProviderId } from "@joyorogo/api/lib/joyo-ai/types";

import { PressableScale } from "@/components/motion";
import { Chip, Input, Skeleton, Text } from "@/components/ui";

interface ModelPickerProps {
  provider: ProviderId;
  value: string;
  onChange: (model: string) => void;
  /** The provider's own list, once it has been loaded with the key; null before. */
  models: readonly ModelInfo[] | null;
  loading?: boolean;
  /** Why the list could not be loaded, already worded. */
  error?: string | null;
}

/**
 * Choosing the model. With the provider's list: a search field over it and the tool-capable models first, each marked when the
 * provider says it cannot call tools. Without it (before the connection test, or a gateway that has no list): the id typed
 * directly, and the preset's suggestions as one-tap choices.
 */
export function ModelPicker({
  provider,
  value,
  onChange,
  models,
  loading,
  error,
}: ModelPickerProps) {
  const { t } = useTranslation("joyoAiApp");
  const { theme } = useUnistyles();
  const [query, setQuery] = useState("");
  const suggested = PROVIDERS[provider].suggested;
  const listed = models && models.length > 0 ? models : null;
  const chosen = listed?.find((m) => m.id === value);
  const results = listed ? searchModels(listed, query) : [];

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t("model.title")}</Text>
      {listed ? (
        <>
          <Text style={styles.strong}>{t("model.selected", { model: value })}</Text>
          {chosen?.tools === false ? (
            <Text style={[styles.small, { color: theme.colors.destructive }]}>
              {t("model.noToolsChosen")}
            </Text>
          ) : null}
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={t("model.search")}
            accessibilityLabel={t("model.search")}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {results.map((model) => {
            const selected = model.id === value;
            return (
              <PressableScale
                key={model.id}
                accessibilityRole="radio"
                accessibilityLabel={
                  model.tools === false ? `${model.id}. ${t("model.noTools")}` : model.id
                }
                accessibilityState={{ selected }}
                onPress={() => onChange(model.id)}
                scaleTo={0.985}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <Text style={styles.body} numberOfLines={1}>
                    {model.id}
                  </Text>
                  {model.tools === false ? (
                    <Text style={styles.small}>{t("model.noTools")}</Text>
                  ) : null}
                </View>
                {selected ? (
                  <Ionicons name="checkmark" size={18} color={theme.colors.primary} />
                ) : null}
              </PressableScale>
            );
          })}
          {results.length === 0 ? <Text style={styles.small}>{t("model.none")}</Text> : null}
          <Text style={styles.small}>{t("model.noToolsHint")}</Text>
        </>
      ) : (
        <>
          <Input
            value={value}
            onChangeText={onChange}
            placeholder={t("model.direct")}
            accessibilityLabel={t("model.title")}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {suggested.length > 0 ? (
            <View style={styles.chips}>
              {suggested.map((model) => (
                <Chip
                  key={model}
                  label={model}
                  selected={model === value}
                  onPress={() => onChange(model)}
                />
              ))}
            </View>
          ) : null}
          {loading ? <Skeleton width="100%" height={44} /> : null}
          {error ? (
            <Text style={[styles.small, { color: theme.colors.destructive }]}>{error}</Text>
          ) : null}
          {!loading && !error && models === null ? (
            <Text style={styles.small}>{t("model.afterTest")}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.sm },
  label: { fontSize: theme.fontSize.sm, fontWeight: "600", color: theme.colors.mutedForeground },
  strong: { fontSize: theme.fontSize.base, fontWeight: "700" },
  body: { fontSize: theme.fontSize.base },
  small: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  rowText: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
}));
