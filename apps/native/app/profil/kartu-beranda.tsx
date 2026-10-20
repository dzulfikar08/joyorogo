import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { homeCardsFor, isDefaultHomeCards, type HomeCardId } from "@joyorogo/api/lib/home-cards";
import { useTranslation } from "react-i18next";
import { Pressable, Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ProfilPage } from "@/components/profil/page";
import { Button, Card, Text } from "@/components/ui";
import { useHomeCards } from "@/src/lib/home-cards-store";

const NATIVE_CARDS = new Set<string>(homeCardsFor("native"));

function MoveButton({
  direction,
  label,
  disabled,
  onPress,
}: {
  direction: "up" | "down";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.move, disabled && styles.moveDisabled]}
    >
      <Ionicons name={direction === "up" ? "chevron-up" : "chevron-down"} size={20} color={theme.colors.foreground} />
    </Pressable>
  );
}

/**
 * "Atur kartu Beranda": every card with a switch and up / down buttons. Buttons rather than a drag handle: they work with
 * TalkBack and VoiceOver, a hardware keyboard and a shaky thumb, and the position is read out on each row.
 */
export default function KartuBeranda() {
  const { t } = useTranslation("home");
  const { theme } = useUnistyles();
  const { prefs, setHidden, move, reset } = useHomeCards();
  const listed = prefs.order.filter((id) => NATIVE_CARDS.has(id));
  const name = (id: HomeCardId) => t(`cards.names.${id}`);

  return (
    <ProfilPage title={t("cards.title")}>
      <Text style={styles.lead}>{t("cards.lead")}</Text>
      <Card style={styles.list}>
        {listed.map((id, i) => {
          const shown = !prefs.hidden.includes(id);
          return (
            <View
              key={id}
              style={[styles.row, i > 0 && styles.rowDivider]}
              accessible={false}
            >
              <Text
                style={[styles.name, !shown && styles.nameOff]}
                accessibilityLabel={t("cards.position", { card: name(id), n: i + 1, total: listed.length })}
              >
                {name(id)}
              </Text>
              <MoveButton direction="up" label={t("cards.moveUp", { card: name(id) })} disabled={i === 0} onPress={() => move(id, -1)} />
              <MoveButton
                direction="down"
                label={t("cards.moveDown", { card: name(id) })}
                disabled={i === listed.length - 1}
                onPress={() => move(id, 1)}
              />
              <Switch
                accessibilityLabel={name(id)}
                value={shown}
                onValueChange={(value) => setHidden(id, !value)}
                trackColor={{ true: theme.colors.primary }}
              />
            </View>
          );
        })}
      </Card>
      {isDefaultHomeCards(prefs) ? null : <Button label={t("cards.reset")} icon="refresh" variant="secondary" onPress={reset} />}
    </ProfilPage>
  );
}

const styles = StyleSheet.create((theme) => ({
  lead: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  list: { paddingVertical: 0, gap: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs, minHeight: 56 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.hairline },
  name: { flex: 1, marginRight: theme.spacing.xs, fontSize: theme.fontSize.base, fontWeight: "600", color: theme.colors.foreground },
  nameOff: { color: theme.colors.mutedForeground },
  move: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  moveDisabled: { opacity: 0.3 },
}));
