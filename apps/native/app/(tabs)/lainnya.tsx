import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { useAppConfig } from "@/components/billing";
import {
  Avatar,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Skeleton,
} from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { useUnreadCount } from "@/src/lib/group";
import { orpc } from "@/utils/orpc";

/**
 * Lainnya tab: the overflow destination — Profil, Grup, Kotak Masuk, and the
 * Founder paywall when the account is still free.
 */
export default function Lainnya() {
  const { t } = useTranslation();
  const gate = useSessionGate();
  const { data: session } = authClient.useSession();
  const config = useAppConfig();
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const unread = useUnreadCount();
  const unreadCount = unread.data?.count ?? 0;
  const displayName = session?.user.name ?? t("more.fallbackNameNative");

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title={t("more.title")} />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={140} radius={20} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  // Free accounts see the paywall row; Pro (founder) sees nothing to buy, so the
  // row is hidden (/founder bounces a Pro account back home). The row also
  // needs a working checkout: /founder bounces back when billing is off
  // (self-hosted copies, Play build).
  const showPricing =
    profile.data?.tier === "free" &&
    config.data?.paywall === true &&
    (Platform.OS === "ios" ? config.data.appleBilling : config.data.billing);

  return (
    <Screen>
      <PageHeader title={t("more.title")} caption={t("more.subtitleNative")} />
      <ListGroup>
        <ListRow
          thumb={<Avatar name={displayName} image={session?.user.image ?? null} size={32} />}
          title={displayName}
          subtitle={session?.user.email ?? "-"}
          chevron
          onPress={() => router.push("/profil")}
        />
        <ListRow
          icon="scale"
          iconTint="tidur"
          title={t("more.weight.title")}
          subtitle={t("more.weight.subtitle")}
          chevron
          onPress={() => router.push("/berat")}
        />
        <ListRow
          icon="calendar"
          iconTint="makan"
          title={t("more.recap.title")}
          subtitle={t("more.recap.subtitle")}
          chevron
          onPress={() => router.push("/rekap")}
        />
        <ListRow
          icon="people"
          iconTint="makan"
          title={t("more.groups.title")}
          subtitle={t("more.groups.subtitleNative")}
          value={unreadCount > 0 ? String(unreadCount) : undefined}
          chevron
          onPress={() => router.push("/grup")}
        />
        <ListRow
          icon="notifications"
          iconTint="bakar"
          title={t("more.inbox.title")}
          subtitle={t("more.inbox.subtitle")}
          value={unreadCount > 0 ? String(unreadCount) : undefined}
          chevron
          onPress={() => router.push("/inbox")}
        />
        {showPricing ? (
          <ListRow
            icon="star"
            iconTint="tidur"
            title={t("more.pricing.title")}
            subtitle={t("more.pricing.subtitleNative")}
            chevron
            onPress={() =>
              router.push({ pathname: "/founder", params: { from: "profile" } })
            }
          />
        ) : null}
      </ListGroup>
    </Screen>
  );
}
