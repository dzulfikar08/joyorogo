import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  PLAY_ACTIVE,
  fmtFounderDate,
  openManageSubscriptions,
  useAppConfig,
  usePlayPrices,
} from "@/components/billing";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";
import { Avatar, Button, Card, Text } from "@/components/ui";
import { keluargaPlatformAllowed, shareKeluargaInvite } from "@/src/lib/keluarga";
import { errorMessage, fmtIdr } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const fmtMs = (ms: number) => fmtFounderDate(new Date(ms));

type Confirm = { kind: "leave" } | { kind: "remove"; userId: string; name: string } | null;

/**
 * Joyo Keluarga on Profil > Langganan, like the web card (apps/web/src/components/profil/keluarga-card.tsx). Owner:
 * period, seats, members (Hapus), pending invites (Batalkan), Undang through the share sheet. Member: whose household,
 * until when, Keluar. Nobody sees anyone's email or data. Nothing renders while the server has the plan off.
 */
export function KeluargaCard({ ownUntil }: { ownUntil: string | Date | null }) {
  const { t } = useTranslation("keluarga");
  const toast = useToast();
  const config = useAppConfig();
  const household = useQuery(orpc.household.get.queryOptions());
  // The Play build never shows a web price: the upsell quotes Play's own monthly price, or waits for it.
  const playPrices = usePlayPrices(PLAY_ACTIVE && household.data?.enabled === true, "keluarga");
  const [confirm, setConfirm] = useState<Confirm>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.household.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
  };
  const onError = (error: Error) => toast.error(errorMessage(error));

  const invite = useMutation(
    orpc.household.createInvite.mutationOptions({
      onSuccess: async ({ code }) => {
        refresh();
        await shareKeluargaInvite(code).catch(() => {});
      },
      onError,
    }),
  );
  const cancelInvite = useMutation(
    orpc.household.cancelInvite.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success(t("screen.invites.canceled"));
      },
      onError,
    }),
  );
  const leave = useMutation(
    orpc.household.leave.mutationOptions({
      onSuccess: () => {
        setConfirm(null);
        refresh();
        toast.success(t("screen.member.left"));
      },
      onError,
    }),
  );
  const remove = useMutation(
    orpc.household.removeMember.mutationOptions({
      onSuccess: () => {
        const name = confirm?.kind === "remove" ? confirm.name : "";
        setConfirm(null);
        refresh();
        toast.success(t("screen.members.removed", { name }));
      },
      onError,
    }),
  );

  const data = household.data;
  if (!data?.enabled) return null;
  const home = data.household;
  // Buying needs the plan on the server, billing on this build, and (iOS) the separate store-side switch.
  const offer =
    config.data?.billing && keluargaPlatformAllowed() ? (config.data.keluarga ?? null) : null;
  const toPaywall = () =>
    router.push({
      pathname: "/founder",
      params: { plan: "keluarga", from: "profile", next: "/profil/langganan" },
    });

  if (!home) {
    const price = PLAY_ACTIVE ? (playPrices.data?.monthly?.displayPrice ?? null) : offer ? fmtIdr(offer.monthlyIdr) : null;
    if (!offer || !price) return null;
    return (
      <Card style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title}>{t("screen.upsell.title")}</Text>
          <Text style={styles.note}>
            {t("screen.upsell.body", { count: offer.seats, price })}
          </Text>
        </View>
        <Button size="sm" variant="secondary" label={t("screen.upsell.cta")} onPress={toPaywall} />
      </Card>
    );
  }

  if (home.role === "member") {
    const own = ownUntil ? new Date(ownUntil) : null;
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>{t("screen.member.title", { owner: home.ownerName })}</Text>
        <Text style={styles.note}>
          {home.paid && home.paidUntil !== null
            ? t("screen.member.until", { date: fmtMs(home.paidUntil) })
            : t("screen.member.lapsed", { owner: home.ownerName })}
        </Text>
        {own && own.getTime() > Date.now() ? (
          <Text style={styles.note}>{t("screen.own", { date: fmtFounderDate(own) })}</Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            label={t("screen.member.leave")}
            onPress={() => setConfirm({ kind: "leave" })}
          />
        </View>
        <ConfirmSheet
          visible={confirm?.kind === "leave"}
          onClose={() => setConfirm(null)}
          title={t("screen.member.leave")}
          message={t("screen.member.leaveConfirm", { owner: home.ownerName })}
          confirmLabel={t("screen.confirm")}
          cancelLabel={t("screen.cancel")}
          loading={leave.isPending}
          onConfirm={() => leave.mutate(undefined)}
        />
      </Card>
    );
  }

  const used = home.members.length;
  const full = used + home.invites.length >= data.seats;
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title}>{t("screen.owner.title")}</Text>
          <Text style={styles.note}>
            {home.paid && home.paidUntil !== null
              ? t("screen.owner.until", { date: fmtMs(home.paidUntil) })
              : t("screen.owner.lapsed")}
          </Text>
          <Text style={styles.note}>{t("screen.owner.seats", { used, count: data.seats })}</Text>
        </View>
        {offer ? (
          <Button size="sm" variant="secondary" label={t("screen.owner.renew")} onPress={toPaywall} />
        ) : null}
        {offer && PLAY_ACTIVE ? (
          // A Play subscription renews by itself; this opens Play's page of the keluarga subscription.
          <Button
            size="sm"
            variant="secondary"
            label={t("cards.manage", { ns: "billing" })}
            onPress={() => void openManageSubscriptions("keluarga").catch(() => {})}
          />
        ) : null}
      </View>

      <Text style={styles.section}>{t("screen.members.title")}</Text>
      {home.members.map((member) => (
        <View key={member.userId} style={styles.row}>
          <Avatar name={member.name} image={member.image} size={36} />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {member.name}
            </Text>
            <Text style={styles.small}>
              {member.role === "owner"
                ? t("screen.members.owner")
                : t("screen.members.joined", { date: fmtMs(member.joinedAt) })}
            </Text>
          </View>
          {member.role === "member" ? (
            <Button
              size="sm"
              variant="ghost"
              label={t("screen.members.remove")}
              onPress={() => setConfirm({ kind: "remove", userId: member.userId, name: member.name })}
            />
          ) : null}
        </View>
      ))}

      {home.invites.length > 0 ? (
        <>
          <Text style={styles.section}>{t("screen.invites.title")}</Text>
          {home.invites.map((pending) => (
            <View key={pending.id} style={styles.row}>
              <Text style={[styles.note, styles.text]}>
                {t("screen.invites.expires", { date: fmtMs(pending.expiresAt) })}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                label={t("screen.invites.cancel")}
                disabled={cancelInvite.isPending}
                onPress={() => cancelInvite.mutate({ id: pending.id })}
              />
            </View>
          ))}
        </>
      ) : null}

      <Button
        label={invite.isPending ? t("screen.owner.inviting") : t("screen.owner.invite")}
        loading={invite.isPending}
        disabled={!home.paid || full}
        onPress={() => invite.mutate(undefined)}
        style={styles.invite}
      />
      <Text style={styles.small}>{t("screen.owner.cannotLeave")}</Text>

      <ConfirmSheet
        visible={confirm?.kind === "remove"}
        onClose={() => setConfirm(null)}
        title={t("screen.members.remove")}
        message={confirm?.kind === "remove" ? t("screen.members.removeConfirm", { name: confirm.name }) : ""}
        confirmLabel={t("screen.confirm")}
        cancelLabel={t("screen.cancel")}
        loading={remove.isPending}
        onConfirm={() => {
          if (confirm?.kind === "remove") remove.mutate({ userId: confirm.userId });
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  name: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  small: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 17,
  },
  section: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: theme.colors.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    marginTop: theme.spacing.xs,
  },
  invite: {
    marginTop: theme.spacing.sm,
  },
}));
