import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  CONTAINER_PRESETS,
  netScaleGrams,
  parseContainers,
  rememberContainer,
  scaleGrams,
  scaleValue,
} from "@joyorogo/api/lib/scale-chip";
import type { ScaleReadChip } from "@joyorogo/api/lib/scale-chip";

import { Mascot } from "@/components/mascot";
import { Button, Chip, Input, Text } from "@/components/ui";
import { fmtGramsLabel } from "@/utils/format";

// The last empty containers this phone subtracted, newest first (a person reuses the same bowls). Local only.
const CONTAINERS_KEY = "joyorogo.scan.containers";

/**
 * Under a scan row whose weight was read off a kitchen-scale display in the
 * photo (lib/scale-reading.ts): "Terbaca dari timbangan: 100 g" and "Perkiraan
 * foto: 150 g", one tap to switch. The row's numbers follow the pick
 * (swapScaleRead); the grams can still be corrected in the box below.
 *
 * "Termasuk wadah?": the scale often weighed the bowl or plate with the food. The
 * chip opens the empty container's weight (remembered ones, a rough bowl and plate,
 * or typed); `onTare` takes it off the reading (tareScaleRows) and answers false
 * when the container is not lighter than the reading.
 */
export function ScaleReadChips({
  name,
  item,
  onSwap,
  onTare,
}: {
  name: string;
  item: { grams?: number; scaleRead?: ScaleReadChip };
  onSwap: () => void;
  onTare: (grams: number) => boolean;
}) {
  const { t } = useTranslation("scan");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [tooHeavy, setTooHeavy] = useState(false);
  const [recent, setRecent] = useState<number[]>([]);
  useEffect(() => {
    if (!open) return;
    SecureStore.getItemAsync(CONTAINERS_KEY)
      .then((raw) => setRecent(parseContainers(raw)))
      .catch(() => setRecent([]));
  }, [open]);

  const grams = scaleGrams(item);
  const chip = item.scaleRead;
  if (!grams || !chip) return null;
  const scaleActive = chip.active === "scale";
  const value = scaleValue(chip, fmtGramsLabel);
  const tare = chip.tare ?? 0;

  const apply = (next: number) => {
    if (next > 0 && netScaleGrams(chip, next) === null) {
      setTooHeavy(true);
      return;
    }
    if (!onTare(next)) {
      setTooHeavy(true);
      return;
    }
    if (next > 0) {
      const list = rememberContainer(recent, next);
      setRecent(list);
      SecureStore.setItemAsync(CONTAINERS_KEY, JSON.stringify(list)).catch(() => {});
    }
    setTooHeavy(false);
    setTyped("");
    setOpen(false);
  };
  const typedGrams = Number(typed.replace(",", "."));
  const presets = CONTAINER_PRESETS.filter((p) => !recent.some((g) => Math.abs(g - p.grams) <= 5));

  return (
    <View style={styles.wrap}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("result.items.scaleGroup", { name })}
        style={styles.row}
      >
        <Chip
          compact
          label={
            chip.tareKind && tare > 0
              ? t(
                  chip.count > 1
                    ? "result.items.scaleReadSharedTared"
                    : "result.items.scaleReadTared",
                  {
                    value,
                    count: chip.count,
                    container: t(`result.items.container_${chip.tareKind}`),
                    tare: fmtGramsLabel(tare),
                  },
                )
              : chip.count > 1
                ? t("result.items.scaleReadShared", { value, count: chip.count })
                : t("result.items.scaleRead", { value })
          }
          selected={scaleActive}
          onPress={scaleActive ? () => {} : onSwap}
        />
        <Chip
          compact
          label={t("result.items.scaleAi", { grams: fmtGramsLabel(grams.ai) })}
          selected={!scaleActive}
          onPress={scaleActive ? onSwap : () => {}}
        />
        {scaleActive ? (
          <Chip
            compact
            label={
              tare > 0
                ? t(
                    chip.tareKind ? "result.items.tareAppliedEstimate" : "result.items.tareApplied",
                    { grams: fmtGramsLabel(tare) },
                  )
                : t("result.items.tareChip")
            }
            selected={tare > 0 || open}
            onPress={() => {
              setTooHeavy(false);
              setOpen((was) => !was);
            }}
          />
        ) : null}
      </View>
      {open && scaleActive ? (
        <View style={styles.panel}>
          <View style={styles.head}>
            <Mascot pose="scale" size="sm" />
            <View style={styles.headText}>
              <Text style={styles.title}>{t("result.items.tareTitle")}</Text>
              <Text style={styles.hint}>{t("result.items.tareHint")}</Text>
            </View>
          </View>
          <View style={styles.row}>
            {recent.map((g) => (
              <Chip key={`r${g}`} compact label={fmtGramsLabel(g)} onPress={() => apply(g)} />
            ))}
            {presets.map((p) => (
              <Chip
                key={p.key}
                compact
                label={t(`result.items.tare_${p.key}`, { grams: fmtGramsLabel(p.grams) })}
                onPress={() => apply(p.grams)}
              />
            ))}
          </View>
          <View style={styles.inputRow}>
            <Input
              value={typed}
              onChangeText={(text) => {
                setTooHeavy(false);
                setTyped(text.replace(/[^\d.,]/g, ""));
              }}
              keyboardType="number-pad"
              placeholder="0"
              accessibilityLabel={t("result.items.tareInput")}
              style={styles.input}
            />
            <Text style={styles.unit}>g</Text>
            <Button
              size="sm"
              label={t("result.items.tareApply")}
              disabled={!(typedGrams >= 1)}
              onPress={() => apply(Math.round(typedGrams))}
            />
            {tare > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                label={t("result.items.tareRemove")}
                onPress={() => apply(0)}
              />
            ) : null}
          </View>
          {tooHeavy ? (
            <Text style={styles.error} accessibilityRole="alert">
              {t("result.items.tareTooHeavy", { grams: fmtGramsLabel(chip.grams) })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  },
  panel: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.input,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  headText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  title: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.medium,
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  input: {
    width: 88,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  unit: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  error: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
}));
