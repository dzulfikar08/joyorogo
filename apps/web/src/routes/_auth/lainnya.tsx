import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, CalendarCheck, Plug, Scale, Sparkles, Tag, Users, Watch } from "lucide-react";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/avatar";
import { ListGroup, ListLinkRow, Page, PageHeader } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import { useSession } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/app-config";
import { orpc } from "@/utils/orpc";

const profileOptions = () => orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/lainnya")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions()),
  pendingComponent: LainnyaSkeleton,
  component: LainnyaPage,
});

function LainnyaSkeleton() {
  const { t } = useTranslation();
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("more.loading")}>
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-32 rounded-full" />
      </div>
      <Skeleton className="h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
    </Page>
  );
}

/** Unread nudge pill reused on the Grup and Kotak masuk rows. */
function UnreadValue({ count }: { count: number }) {
  return (
    <span className="grid min-w-[1.35rem] place-items-center rounded-full bg-destructive px-1.5 py-0.5 text-[0.6875rem] leading-4 font-bold text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function LainnyaPage() {
  const { t } = useTranslation(["common", "koneksi"]);
  const session = useSession();
  const unread = useQuery(orpc.group.unreadCount.queryOptions());
  const profile = useQuery(profileOptions());
  const config = useAppConfig();

  if (profile.isPending) return <LainnyaSkeleton />;
  if (profile.error) {
    return <ScreenError message={profile.error.message} onRetry={() => profile.refetch()} />;
  }

  const count = unread.data?.count ?? 0;
  const isFree = profile.data.tier === "free";
  const name = session.data?.user.name ?? t("more.fallbackNameWeb");

  return (
    <Page className="max-w-xl">
      <PageHeader title={t("more.title")} subtitle={t("more.subtitleWeb")} />

      <ListGroup className="mt-1">
        <ListLinkRow
          to="/profil"
          icon={<Avatar name={name} image={session.data?.user.image ?? null} />}
          title={name}
          subtitle={session.data?.user.email ?? undefined}
        />
        <ListLinkRow
          to="/berat"
          icon={
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tidur-soft">
              <Scale className="size-5 text-tidur-ink" aria-hidden />
            </span>
          }
          title={t("more.weight.title")}
          subtitle={t("more.weight.subtitle")}
        />
        <ListLinkRow
          to="/rekap"
          icon={
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10">
              <CalendarCheck className="size-5 text-primary" aria-hidden />
            </span>
          }
          title={t("more.recap.title")}
          subtitle={t("more.recap.subtitle")}
        />
        <ListLinkRow
          to="/jam"
          icon={
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bakar-soft">
              <Watch className="size-5 text-bakar-ink" aria-hidden />
            </span>
          }
          title={t("more.workouts.title")}
          subtitle={t("more.workouts.subtitle")}
        />
        <ListLinkRow
          to="/grup"
          icon={
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10">
              <Users className="size-5 text-primary" aria-hidden />
            </span>
          }
          title={t("more.groups.title")}
          subtitle={t("more.groups.subtitleWeb")}
          value={count > 0 ? <UnreadValue count={count} /> : undefined}
        />
        <ListLinkRow
          to="/inbox"
          icon={
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-makan-soft">
              <Bell className="size-5 text-makan-ink" aria-hidden />
            </span>
          }
          title={t("nav.title.inbox")}
          subtitle={t("more.inbox.subtitle")}
          value={count > 0 ? <UnreadValue count={count} /> : undefined}
        />
        <ListLinkRow
          to="/koneksi"
          icon={
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tidur-soft">
              <Plug className="size-5 text-tidur-ink" aria-hidden />
            </span>
          }
          title={t("koneksi:title")}
          subtitle={t("koneksi:list.title")}
        />
        {isFree && config.data?.paywall && (
          <ListLinkRow
            to="/harga"
            icon={
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted">
                <Tag className="size-5 text-muted-foreground" aria-hidden />
              </span>
            }
            title={t("more.pricing.title")}
            subtitle={t("more.pricing.subtitleWeb")}
          />
        )}
        {isFree && config.data?.billing && (
          <ListLinkRow
            to="/pro"
            search={{ from: "profile", next: "/lainnya" }}
            icon={
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bakar-soft">
                <Sparkles className="size-5 text-bakar-ink" aria-hidden />
              </span>
            }
            title={t("more.upgrade.title")}
            subtitle={
              config.data.founderDailyCap === null
                ? t("more.upgrade.subtitleUnlimited")
                : t("more.upgrade.subtitleCapped", { count: config.data.founderDailyCap })
            }
          />
        )}
      </ListGroup>
    </Page>
  );
}
