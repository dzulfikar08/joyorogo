import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { localizeTip, type Tip } from "@joyorogo/api/lib/tips";

import { Card, Text } from "@/components/ui";
import { TipIconGlyph } from "@/components/tips/tip-icon";
import { tipImageUrl } from "@/src/lib/tips-img";

/**
 * Kartu tips untuk feed dan Beranda; seluruh kartu menekan ke layar
 * artikel /tips/<slug> yang merender konten statis yang sama dengan blog.
 * Foto hero diambil dari origin web; kalau gagal dimuat, fallback ikon.
 */
export function TipCard({ tip: meta, style }: { tip: Tip; style?: object }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("tips");
  const tip = localizeTip(meta);
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <Card style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("card.aria", { title: tip.title })}
        onPress={() => router.push(`/tips/${tip.slug}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {tip.image && !imgFailed ? (
          <Image
            source={{ uri: tipImageUrl(`${tip.slug}-600.webp`) }}
            onError={() => setImgFailed(true)}
            resizeMode="cover"
            accessibilityLabel={tip.image.alt}
            style={styles.thumb}
          />
        ) : (
          <View style={[styles.iconChip, { backgroundColor: theme.colors.makanSoft }]}>
            <TipIconGlyph icon={tip.icon} color={theme.colors.makanText} />
          </View>
        )}
        <View style={styles.body}>
          <Text style={styles.kicker}>{t("card.kicker")}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {tip.title}
          </Text>
          <Text style={styles.summary} numberOfLines={2}>
            {tip.summary}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: theme.colors.makanSoft,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    color: theme.colors.foreground,
  },
  summary: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
}));
