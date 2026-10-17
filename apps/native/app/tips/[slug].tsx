import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Linking, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { TIPS, localizeTip } from "@joyorogo/api/lib/tips";

import { Disclosure } from "@/components/disclosure";
import { Card, ErrorState, Screen, Text } from "@/components/ui";
import { TipIconGlyph } from "@/components/tips/tip-icon";
import { tipImageUrl } from "@/src/lib/tips-img";

/**
 * Layar artikel tips. Kontennya statis dari @joyorogo/api/lib/tips (teks di
 * namespace `tips`), sama dengan halaman blog /blog/<slug> di web, tanpa
 * klaim yang digenerate saat runtime. Ringkas: hero, ringkasan, dan "Coba ini"
 * langsung terlihat; penjelasan per bagian, sumber, dan catatan ada di akordeon.
 * Foto dan infografis diambil dari origin web (EXPO_PUBLIC_WEB_URL, default
 * joyorogo.com); kalau gagal dimuat, gambar disembunyikan dan teks tetap utuh.
 */
export default function TipArticle() {
  const { theme } = useUnistyles();
  const { t } = useTranslation("tips");
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const meta = TIPS.find((candidate) => candidate.slug === slug);
  const tip = meta ? localizeTip(meta) : undefined;
  const [heroFailed, setHeroFailed] = useState(false);
  const [figureFailed, setFigureFailed] = useState(false);

  if (!tip) {
    return (
      <Screen>
        <ErrorState
          message={t("article.notFound")}
          onRetry={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/feed");
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {tip.image && !heroFailed ? (
        <Image
          source={{ uri: tipImageUrl(`${tip.slug}.webp`) }}
          onError={() => setHeroFailed(true)}
          resizeMode="cover"
          accessibilityLabel={tip.image.alt}
          style={[styles.hero, { backgroundColor: theme.colors.makanSoft }]}
        />
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.iconChip}>
          <TipIconGlyph icon={tip.icon} size={20} color={theme.colors.makanText} />
        </View>
        <Text style={styles.title}>{tip.title}</Text>
      </View>
      <Text style={styles.summary}>{tip.summary}</Text>

      <Card style={styles.cobaCard}>
        <Text style={styles.heading}>{t("article.tryThis")}</Text>
        {tip.cobaIni.map((item) => (
          <View key={item} style={styles.bulletRow}>
            <Text style={styles.bullet} aria-hidden>
              •
            </Text>
            <Text style={styles.bulletText}>{item}</Text>
          </View>
        ))}
      </Card>

      {tip.figure && !figureFailed ? (
        <View style={styles.figure}>
          <Image
            source={{ uri: tipImageUrl(tip.figure.src) }}
            onError={() => setFigureFailed(true)}
            resizeMode="contain"
            accessibilityLabel={tip.figure.alt}
            style={[styles.figureImg, { backgroundColor: theme.colors.card }]}
          />
          <Text style={styles.caption}>{tip.figure.caption}</Text>
        </View>
      ) : null}

      {tip.sections.map((section) => (
        <Disclosure key={section.heading} title={section.heading}>
          {section.paragraphs.map((paragraph, i) => (
            <Text key={i} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </Disclosure>
      ))}

      <Disclosure title={t("article.sourcesTitle")}>
        <View style={styles.sources}>
          {tip.sources.map((source) => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              accessibilityLabel={t("article.openSource", { title: source.title })}
              onPress={() => void Linking.openURL(source.url)}
              style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]}
            >
              <Text style={styles.sourceText}>{source.title}</Text>
              <Ionicons name="open-outline" size={14} color={theme.colors.mutedForeground} />
            </Pressable>
          ))}
          {tip.credit ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={tip.credit.label}
              onPress={() => void Linking.openURL(tip.credit!.url)}
              style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]}
            >
              <Text style={styles.creditText}>{tip.credit.label}</Text>
              <Ionicons name="open-outline" size={14} color={theme.colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        {tip.image ? (
          <Text style={styles.photoCredit}>
            {tip.image.credit.author
              ? t("article.photoBy", {
                  author: tip.image.credit.author,
                  source: tip.image.credit.source,
                  page: tip.image.credit.page,
                })
              : t("article.photoCredit", {
                  source: tip.image.credit.source,
                  page: tip.image.credit.page,
                })}
          </Text>
        ) : null}
        <Text style={styles.disclaimer}>{t("article.disclaimer")}</Text>
      </Disclosure>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: {
    opacity: 0.7,
  },
  hero: {
    width: "100%",
    aspectRatio: 2.2,
    borderRadius: theme.radius.card,
  },
  figure: {
    gap: theme.spacing.sm,
  },
  figureImg: {
    width: "100%",
    aspectRatio: 1200 / 675,
    borderRadius: theme.radius.card,
  },
  caption: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  photoCredit: {
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  iconChip: {
    width: 40,
    height: 40,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    lineHeight: 28,
  },
  summary: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  heading: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  paragraph: {
    fontSize: theme.fontSize.base,
    lineHeight: 24,
  },
  cobaCard: {
    gap: theme.spacing.sm,
  },
  bulletRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  bullet: {
    fontSize: theme.fontSize.base,
    lineHeight: 24,
    color: theme.colors.makan,
  },
  bulletText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    lineHeight: 24,
  },
  sources: {
    gap: theme.spacing.xs,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  sourceText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.makanText,
    textDecorationLine: "underline",
  },
  creditText: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  disclaimer: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
}));
