import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Home } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";
import { Avatar } from "@/components/avatar";
import { IconChip, ListGroup, ListRow } from "@/components/kit/surface";
import { ConfirmSheet } from "@/components/profil/confirm-sheet";
import { fmtRupiah, useAppConfig } from "@/lib/app-config";
import { fmtFounderDate } from "@/lib/billing";
import { shareKeluargaInvite } from "@/lib/keluarga-invite";
import { orpc } from "@/utils/orpc";

const fmtMs = (ms: number) => fmtFounderDate(new Date(ms));

/**
 * Joyo Keluarga on Profil > Langganan (docs/pricing/joyo-keluarga.md section 5). Owner: period, seats, members,
 * pending invites, invite and renew. Member: whose household, until when, leave. Neither sees anyone's email or data.
 * Hidden entirely while the server has the plan off.
 */
export function KeluargaCard({ ownUntil }: { ownUntil: Date | null }) {
  const { t } = useTranslation("keluarga");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = useAppConfig();
  const household = useQuery(orpc.household.get.queryOptions());
  const [confirm, setConfirm] = useState<{ kind: "leave" } | { kind: "remove"; userId: string; name: string } | null>(
    null,
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.household.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
  };
  const onError = (error: Error) => toast.error(error.message);

  const invite = useMutation(
    orpc.household.createInvite.mutationOptions({
      onSuccess: async ({ code }) => {
        refresh();
        try {
          if ((await shareKeluargaInvite(code)) === "copied") toast.success(t("screen.invite.copied"));
        } catch (error) {
          onError(error as Error);
        }
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
  const offer = config.data?.billing ? (config.data.keluarga ?? null) : null;
  const toPaywall = () =>
    navigate({ to: "/pro", search: { plan: "keluarga", from: "profile", next: "/profil/langganan" } });

  if (!home) {
    if (!offer) return null;
    return (
      <ListGroup className="mb-3">
        <ListRow
          icon={
            <IconChip tone="makan">
              <Home />
            </IconChip>
          }
          title={t("screen.upsell.title")}
          subtitle={t("screen.upsell.body", { count: offer.seats, price: fmtRupiah(offer.monthlyIdr) })}
          fullSubtitle
          trailing={
            <Button size="sm" variant="secondary" className="shrink-0" onClick={toPaywall}>
              {t("screen.upsell.cta")}
            </Button>
          }
        />
      </ListGroup>
    );
  }

  if (home.role === "member") {
    return (
      <div className="mb-3 rounded-3xl bg-card p-5">
        <p className="text-[0.9375rem] font-bold">{t("screen.member.title", { owner: home.ownerName })}</p>
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
          {home.paid && home.paidUntil !== null
            ? t("screen.member.until", { date: fmtMs(home.paidUntil) })
            : t("screen.member.lapsed", { owner: home.ownerName })}
        </p>
        {ownUntil && ownUntil.getTime() > Date.now() && (
          <p className="mt-2 text-sm leading-snug text-muted-foreground">
            {t("screen.own", { date: fmtFounderDate(ownUntil) })}
          </p>
        )}
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setConfirm({ kind: "leave" })}>
          {t("screen.member.leave")}
        </Button>
        <ConfirmSheet
          open={confirm?.kind === "leave"}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t("screen.member.leave")}
          body={t("screen.member.leaveConfirm", { owner: home.ownerName })}
          confirmLabel={t("screen.confirm")}
          pending={leave.isPending}
          onConfirm={() => leave.mutate(undefined)}
        />
      </div>
    );
  }

  const used = home.members.length;
  const full = used + home.invites.length >= data.seats;
  return (
    <div className="mb-3 rounded-3xl bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-bold">{t("screen.owner.title")}</p>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
            {home.paid && home.paidUntil !== null
              ? t("screen.owner.until", { date: fmtMs(home.paidUntil) })
              : t("screen.owner.lapsed")}
          </p>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground tabular-nums">
            {t("screen.owner.seats", { used, count: data.seats })}
          </p>
        </div>
        {offer && (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={toPaywall}>
            {t("screen.owner.renew")}
          </Button>
        )}
      </div>

      <p className="mt-4 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        {t("screen.members.title")}
      </p>
      <ul className="mt-2 space-y-2">
        {home.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3">
            <Avatar name={member.name} image={member.image} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{member.name}</p>
              <p className="text-xs text-muted-foreground">
                {member.role === "owner"
                  ? t("screen.members.owner")
                  : t("screen.members.joined", { date: fmtMs(member.joinedAt) })}
              </p>
            </div>
            {member.role === "member" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirm({ kind: "remove", userId: member.userId, name: member.name })}
              >
                {t("screen.members.remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {home.invites.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {t("screen.invites.title")}
          </p>
          <ul className="mt-2 space-y-2">
            {home.invites.map((pending) => (
              <li key={pending.id} className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("screen.invites.expires", { date: fmtMs(pending.expiresAt) })}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancelInvite.isPending}
                  onClick={() => cancelInvite.mutate({ id: pending.id })}
                >
                  {t("screen.invites.cancel")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Button
        className="mt-4 w-full"
        disabled={!home.paid || full || invite.isPending}
        onClick={() => invite.mutate(undefined)}
      >
        {invite.isPending ? t("screen.owner.inviting") : t("screen.owner.invite")}
      </Button>
      <p className="mt-3 text-xs leading-snug text-muted-foreground">{t("screen.owner.cannotLeave")}</p>

      <ConfirmSheet
        open={confirm?.kind === "remove"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("screen.members.remove")}
        body={confirm?.kind === "remove" ? t("screen.members.removeConfirm", { name: confirm.name }) : ""}
        confirmLabel={t("screen.confirm")}
        pending={remove.isPending}
        onConfirm={() => confirm?.kind === "remove" && remove.mutate({ userId: confirm.userId })}
      />
    </div>
  );
}
