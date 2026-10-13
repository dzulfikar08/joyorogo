import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { useState } from "react";
import { Image, Linking, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { TIPS } from "@joyorogo/api/lib/tips";

import { Card, ErrorState, PageHeader, Screen, Text } from "@/components/ui";
import { TipIconGlyph } from "@/components/tips/tip-icon";
import { tipImageUrl } from "@/src/lib/tips-img";

/**
 * Layar artikel tips. Kontennya statis dari @joyorogo/api/lib/tips — sama
 * persis dengan halaman blog /blog/<slug> di web, tanpa klaim yang
 * digenerate saat runtime. Foto dan infografis diambil dari origin web
 * (EXPO_PUBLIC_WEB_URL, default joyorogo.com); kalau gagal dimuat,
 * gambar disembunyikan dan teks tetap utuh.
 */
export default function TipArticle() {
  const { theme } = useUnistyles();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const tip = TIPS.find((candidate) => candidate.slug === slug);
  const [heroFailed, setHeroFailed] = useState(false);
  const [figureFailed, setFigureFailed] = useState(false);

  if (!tip) {
    return (
      <Screen>
        <PageHeader title="Tips" />
        <ErrorState
          message="Tips tidak ditemukan."
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
      <PageHeader title="Tips" />

      {tip.image && !heroFailed ? (
        <Image
          source={{ uri: tipImageUrl(`${tip.slug}.webp`) }}
          onError={() => setHeroFailed(true)}
          resizeMode="cover"
          accessibilityLabel={tip.image.alt}
          style={[styles.hero, { backgroundColor: theme.colors.makanSoft }]}
        />
      ) : null}
      <View style={styles.iconChip}>
        <TipIconGlyph icon={tip.icon} size={22} color={theme.colors.makanText} />
      </View>
      <Text style={styles.title}>{tip.title}</Text>
      <Text style={styles.summary}>{tip.summary}</Text>

      {tip.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.heading}>{section.heading}</Text>
          {section.paragraphs.map((paragraph, i) => (
            <Text key={i} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}

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

      {tip.image ? (
        <Text style={styles.photoCredit}>
          Foto{tip.image.credit.author ? `: ${tip.image.credit.author}` : ""} ·{" "}
          {tip.image.credit.source} · {tip.image.credit.page}
        </Text>
      ) : null}

      <Card style={styles.cobaCard}>
        <Text style={styles.heading}>Coba ini</Text>
        {tip.cobaIni.map((item) => (
          <View key={item} style={styles.bulletRow}>
            <Text style={styles.bullet} aria-hidden>
              •
            </Text>
            <Text style={styles.bulletText}>{item}</Text>
          </View>
        ))}
      </Card>

      <Text style={styles.heading}>Sumber</Text>
      <View style={styles.sources}>
        {tip.sources.map((source) => (
          <Pressable
            key={source.url}
            accessibilityRole="link"
            accessibilityLabel={`Buka sumber: ${source.title}`}
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

      <Text style={styles.disclaimer}>
        Artikel tips ini informasi umum, bukan pengganti saran dokter atau ahli gizi.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: {
    opacity: 0.7,
  },
  hero: {
    width: "100%",
    aspectRatio: 1.5,
    borderRadius: theme.radius.card,
    marginBottom: theme.spacing.md,
  },
  figure: {
    marginTop: theme.spacing.lg,
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
  iconChip: {
    width: 48,
    height: 48,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.sm,
  },
  title: {
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
  section: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
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
    marginTop: theme.spacing.lg,
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
    marginTop: theme.spacing.sm,
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
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
}));
