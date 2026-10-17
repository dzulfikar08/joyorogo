import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  CAFFEINE_LIMIT_MG,
  foodFlagsFor,
  type FoodFlagKey,
  type MaternalInfo,
} from "@joyorogo/api/lib/maternal";

import { Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

import { useCaffeineToday, useMaternal } from "./use-maternal";

/** Neutral info card: soft fill, small icon, no alarm colors. */
export function InfoNote({ title, body }: { title?: string; body: string }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.note}>
      <Ionicons
        name="information-circle-outline"
        size={18}
        color={theme.colors.mutedForeground}
        style={styles.noteIcon}
      />
      <View style={styles.noteText}>
        {title ? <Text style={styles.noteTitle}>{title}</Text> : null}
        <Text style={styles.noteBody}>{body}</Text>
      </View>
    </View>
  );
}

/** MaternalInfo.flags as neutral notes; CONSULT also lists the chosen conditions. */
export function MaternalFlagNotes({ info }: { info: MaternalInfo }) {
  const { t } = useTranslation("maternal");
  if (info.flags.length === 0) return null;
  return (
    <View style={styles.stack}>
      {info.flags.map((flag) => (
        <View key={flag} style={styles.stack}>
          <InfoNote body={t(`notes.${flag}`)} />
          {flag === "CONSULT"
            ? info.conditions.map((condition) => (
                <InfoNote key={condition} body={t(`notes.${condition}`)} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Gentle food-safety notes for the dishes of a scan, review step, diary item
 * or barcode result. One card per key, never blocks saving. Renders nothing
 * outside the maternal modes or when no dish matches.
 *
 * `addToDay`: the dishes are not logged yet, so their caffeine estimate is
 * added to the day total shown under the notes.
 */
export function FoodSafetyNotes({
  names,
  addToDay = false,
}: {
  names: string[];
  addToDay?: boolean;
}) {
  const { t } = useTranslation("maternal");
  const { mode } = useMaternal();
  const day = useCaffeineToday();
  if (mode === "none") return null;

  const byKey = new Map<FoodFlagKey, number>();
  let caffeineMg = 0;
  for (const name of names) {
    for (const flag of foodFlagsFor(name, mode)) {
      byKey.set(flag.key, (byKey.get(flag.key) ?? 0) + (flag.caffeineMg ?? 0));
      caffeineMg += flag.caffeineMg ?? 0;
    }
  }
  if (byKey.size === 0) return null;

  const limit = day?.limitMg ?? CAFFEINE_LIMIT_MG;
  const dayMg = (day?.mg ?? 0) + (addToDay ? caffeineMg : 0);
  return (
    <View style={styles.stack}>
      <Text style={styles.heading}>{t("flags.title")}</Text>
      {[...byKey.entries()].map(([key, mg]) => (
        <InfoNote
          key={key}
          title={t(`flags.${key}.title`)}
          body={key === "caffeine" ? t("flags.caffeine.body", { mg: fmtInt(mg) }) : t(`flags.${key}.body`)}
        />
      ))}
      {byKey.has("caffeine") ? (
        <Text style={styles.caffeineDay}>
          {dayMg > limit
            ? t("flags.caffeineOver", { mg: fmtInt(dayMg), limit: fmtInt(limit) })
            : t("flags.caffeineDay", { mg: fmtInt(dayMg), limit: fmtInt(limit) })}
        </Text>
      ) : null}
      <Text style={styles.footer}>{t("flags.footer")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.spacing.sm,
  },
  note: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  noteIcon: {
    marginTop: 1,
  },
  noteText: {
    flex: 1,
    gap: 2,
  },
  noteTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  noteBody: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  heading: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  caffeineDay: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  footer: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
