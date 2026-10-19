import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState, useEffect } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { BrandMark, HEALTH_BRAND } from "@/components/brand-mark";
import { KoneksiRow } from "@/components/koneksi-row";
import { NeedsSheet } from "@/components/needs-sheet";
import { Group, ProfilDataPage, type ProfileData } from "@/components/profil/page";
import { usePlanStatus } from "@/components/profil/status";
import { useAccountActions } from "@/components/profil/use-account-actions";
import { PressableScale } from "@/components/motion";
import { Avatar, ListRow, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { isHealthSyncSupported } from "@/src/lib/health-sync";
import { installedAppVersion } from "@/src/lib/apk-update";
import { orpc } from "@/utils/orpc";

/**
 * Profil hub: summary card, grouped rows into sub-screens (app/profil/*), destructive group last.
 * `/profil?needs=1` (Beranda) opens the daily-needs breakdown right here.
 */
export default function ProfilHub() {
  const { t } = useTranslation("common");
  return (
    <ProfilDataPage title={t("nav.title.profile")}>
      {(profile) => <Hub profile={profile} />}
    </ProfilDataPage>
  );
}

function Hub({ profile }: { profile: ProfileData }) {
  const { t, i18n } = useTranslation(["settings", "common", "koneksi", "notifications"]);
  const { rt, theme } = useUnistyles();
  const session = authClient.useSession();
  const stravaStatus = useQuery(orpc.strava.status.queryOptions());
  const status = usePlanStatus(profile);
  const account = useAccountActions();

  const [needsOpen, setNeedsOpen] = useState(false);
  const { needs } = useLocalSearchParams<{ needs?: string }>();
  useEffect(() => {
    if (needs === "1") setNeedsOpen(true);
  }, [needs]);

  const name = session.data?.user.name ?? t("common:more.fallbackNameNative");
  const themeName = rt.themeName ?? "system";
  // Language code, not its full name: the full "Sistem · Bahasa Indonesia" squeezes the row title.
  const displayValue = `${t(`settings:theme.${themeName}`)} · ${i18n.language.toUpperCase()}`;

  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("settings:hub.rows.account.title")}
        onPress={() => router.push("/profil/akun")}
        scaleTo={1}
        dimTo={0.7}
        style={styles.summary}
      >
        <Avatar name={name} image={session.data?.user.image ?? null} size={56} />
        <View style={styles.summaryText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {session.data?.user.email ?? "-"}
          </Text>
          {status.text ? (
            <View style={status.pro ? styles.badgePro : styles.badge}>
              <Text style={status.pro ? styles.badgeTextPro : styles.badgeText}>
                {status.text}
              </Text>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
      </PressableScale>

      <Group title={t("settings:hub.groups.account")}>
        <ListRow
          icon="person"
          iconTint="makan"
          title={t("settings:hub.rows.account.title")}
          subtitle={t("settings:hub.rows.account.subtitle")}
          chevron
          onPress={() => router.push("/profil/akun")}
        />
        <ListRow
          icon="star"
          iconTint="tidur"
          title={t("settings:hub.rows.subscription.title")}
          subtitle={t("settings:hub.rows.subscription.subtitle")}
          value={
            profile.tier === "founder"
              ? t("settings:hub.rows.subscription.valuePro")
              : t("settings:hub.rows.subscription.valueFree")
          }
          chevron
          onPress={() => router.push("/profil/langganan")}
        />
      </Group>

      <Group title={t("settings:hub.groups.body")}>
        <ListRow
          icon="flag"
          iconTint="makan"
          title={t("settings:hub.rows.body.title")}
          subtitle={t("settings:hub.rows.body.subtitle")}
          chevron
          onPress={() => router.push("/profil/target")}
        />
        <ListRow
          icon="restaurant"
          iconTint="bakar"
          title={t("settings:hub.rows.meals.title")}
          subtitle={t("settings:hub.rows.meals.subtitle")}
          chevron
          onPress={() => router.push("/profil/makan")}
        />
      </Group>

      <Group title={t("settings:hub.groups.connections")}>
        <ListRow
          thumb={<BrandMark brand="strava" />}
          title={t("settings:hub.rows.strava.title")}
          subtitle={t("settings:hub.rows.strava.subtitle")}
          value={
            stravaStatus.data?.connected ? t("settings:hub.rows.strava.valueConnected") : undefined
          }
          chevron
          onPress={() => router.push("/profil/strava")}
        />
        {isHealthSyncSupported() ? (
          <ListRow
            thumb={<BrandMark brand={HEALTH_BRAND} />}
            title={t(
              HEALTH_BRAND === "appleHealth"
                ? "settings:hub.rows.healthIos.title"
                : "settings:hub.rows.healthAndroid.title",
            )}
            subtitle={t(
              HEALTH_BRAND === "appleHealth"
                ? "settings:hub.rows.healthIos.subtitle"
                : "settings:hub.rows.healthAndroid.subtitle",
            )}
            chevron
            onPress={() => router.push("/profil/kesehatan")}
          />
        ) : null}
        <KoneksiRow />
      </Group>

      <Group title={t("settings:hub.groups.community")}>
        <ListRow
          icon="notifications"
          iconTint="bakar"
          title={t("settings:hub.rows.reminders.title")}
          subtitle={t("settings:hub.rows.reminders.subtitle")}
          chevron
          onPress={() => router.push("/profil/pengingat")}
        />
        <ListRow
          icon="notifications-circle"
          iconTint="bakar"
          title={t("notifications:title")}
          subtitle={t("notifications:native.hubSubtitle")}
          chevron
          onPress={() => router.push("/profil/notifikasi")}
        />
        <ListRow
          icon="people"
          iconTint="tidur"
          title={t("settings:hub.rows.feed.title")}
          subtitle={t("settings:hub.rows.feed.subtitle")}
          chevron
          onPress={() => router.push("/profil/feed")}
        />
      </Group>

      <Group title={t("settings:hub.groups.app")}>
        <ListRow
          icon="color-palette"
          iconTint="makan"
          title={t("settings:hub.rows.display.title")}
          subtitle={t("settings:hub.rows.display.subtitle")}
          value={displayValue}
          chevron
          onPress={() => router.push("/profil/tampilan")}
        />
        <ListRow
          icon="shield-checkmark"
          iconTint="makan"
          title={t("settings:hub.rows.privacy.title")}
          subtitle={t("settings:hub.rows.privacy.subtitle")}
          chevron
          onPress={() => router.push("/profil/privasi")}
        />
        <ListRow
          icon="information-circle"
          iconTint="muted"
          title={t("settings:hub.rows.about.title")}
          subtitle={t("settings:hub.rows.about.subtitle")}
          value={installedAppVersion().versionName}
          chevron
          onPress={() => router.push("/profil/tentang")}
        />
      </Group>

      <Group>
        <ListRow
          icon="log-out"
          title={t("settings:account.signOut")}
          destructive
          onPress={account.askSignOut}
        />
        <ListRow
          icon="person-remove"
          title={t("settings:account.delete.title")}
          destructive
          onPress={account.askDeleteAccount}
          right={
            account.deleteAccountPending ? (
              <Text style={styles.pending}>{t("settings:privacy.wipe.deletingNative")}</Text>
            ) : undefined
          }
        />
      </Group>

      {profile.targets ? (
        <NeedsSheet
          visible={needsOpen}
          onClose={() => setNeedsOpen(false)}
          targets={profile.targets}
        />
      ) : null}
      {account.sheets}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
  },
  summaryText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  email: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  badgePro: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.makanSoft,
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  badgeTextPro: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  pending: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructiveText,
  },
}));
