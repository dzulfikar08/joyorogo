import { Navigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Targets } from "@joyorogo/api/lib/engine";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Page, PageHeader } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import type { ProfileRow } from "@/lib/api-types";
import { useSession } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const profileOptions = orpc.profile.myProfile.queryOptions();

export type ProfilCtx = {
  row: ProfileRow;
  targets: Targets;
  latestWeightKg: number | null;
  tier: "free" | "founder";
  founderUntil: Date | null;
  name: string | null;
  email: string | null;
  image: string | null;
};

/**
 * Loads the profile once for a Profil screen: skeleton while pending, error
 * screen with retry, onboarding redirect when no plan exists yet.
 */
export function ProfilGate({
  title,
  subtitle,
  backTo = "sub",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** `hub`: the hub itself (no back link); `sub`: a sub-screen with a back link to /profil. */
  backTo?: "hub" | "sub";
  children: (ctx: ProfilCtx) => ReactNode;
}) {
  const profile = useQuery(profileOptions);
  const session = useSession();
  const user = session.data?.user;

  if (profile.isPending) return <ProfilSkeleton sub={backTo === "sub"} />;
  if (profile.error) {
    return <ScreenError message={profile.error.message} onRetry={() => profile.refetch()} />;
  }
  if (!profile.data.profile || !profile.data.targets) {
    return <Navigate to="/onboarding" replace />;
  }
  const { profile: row, targets, latestWeightKg, tier, founderUntil } = profile.data;
  const ctx: ProfilCtx = {
    row,
    targets,
    latestWeightKg,
    tier,
    founderUntil,
    name: user?.name ?? null,
    email: user?.email ?? null,
    image: user?.image ?? null,
  };
  return (
    <Page className="max-w-xl">
      {backTo === "sub" && <BackToProfil />}
      <PageHeader title={title} subtitle={subtitle} className={backTo === "sub" ? "pt-0" : undefined} />
      {children(ctx)}
    </Page>
  );
}

function BackToProfil() {
  const { t } = useTranslation("settings");
  return (
    <Link
      to="/profil"
      className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <ChevronLeft className="size-5" aria-hidden />
      {t("hubWeb.back")}
    </Link>
  );
}

export function ProfilSkeleton({ sub = false }: { sub?: boolean }) {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("profile.loading")}>
      {sub ? (
        <>
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="mt-5 h-9 w-48 rounded-full" />
        </>
      ) : (
        <div className="px-1 pt-2 pb-5">
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
      )}
      <Skeleton className={sub ? "mt-5 h-40 rounded-3xl" : "h-20 rounded-3xl"} />
      <Skeleton className="mt-7 h-5 w-24 rounded-full" />
      <Skeleton className="mt-3 h-36 rounded-3xl" />
      <Skeleton className="mt-7 h-5 w-28 rounded-full" />
      <Skeleton className="mt-3 h-36 rounded-3xl" />
    </Page>
  );
}
