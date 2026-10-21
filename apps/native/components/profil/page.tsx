import "@/unistyles";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { InferClientOutputs } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native-unistyles";
import { View } from "react-native";

import { BootLoader, ErrorState, ListGroup, PageHeader, Screen, SectionTitle, Skeleton, Text } from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/** Output of `profile.myProfile` (profile row, targets, tier, latest weight). */
export type ProfileData = InferClientOutputs<AppRouterClient>["profile"]["myProfile"];

export function useProfile() {
  return useQuery(orpc.profile.myProfile.queryOptions());
}

/**
 * Shell of every Profil screen: session gate (spinner, /login for anonymous users), then the
 * page header and content. Hooks of the content live in children, so they only run once the gate
 * has let the user through.
 */
export function ProfilPage({
  title,
  headerRight,
  children,
}: {
  title: string;
  /** Trailing node of the title row (a brand mark). */
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const gate = useSessionGate();
  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;
  return (
    <Screen>
      <PageHeader title={title} right={headerRight} />
      {children}
    </Screen>
  );
}

/** ProfilPage for screens that read the profile: skeleton while loading, retry on error, then `children(data)`. */
export function ProfilDataPage({
  title,
  headerRight,
  children,
}: {
  title: string;
  headerRight?: ReactNode;
  children: (data: ProfileData) => ReactNode;
}) {
  return (
    <ProfilPage title={title} headerRight={headerRight}>
      <ProfileLoader>{children}</ProfileLoader>
    </ProfilPage>
  );
}

function ProfileLoader({ children }: { children: (data: ProfileData) => ReactNode }) {
  const query = useProfile();
  if (query.isPending) {
    return (
      <>
        <Skeleton width="100%" height={96} radius={24} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
      </>
    );
  }
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}

/** Section header above one rounded card of rows (Profil hub groups). */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      {title ? <SectionTitle title={title} /> : null}
      <ListGroup>{children}</ListGroup>
    </View>
  );
}

/** Muted explanatory paragraph under a card. */
export function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

/** Smaller muted line that hugs the block above it. */
export function Caption({ children }: { children: ReactNode }) {
  return <Text style={styles.caption}>{children}</Text>;
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  group: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  caption: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 18,
    marginTop: -theme.spacing.sm,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
