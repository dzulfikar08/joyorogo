import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { ORPCError } from "@orpc/client";
import { CloudOff, Crown, Loader2, RotateCw, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { FitApiError } from "@/lib/fit-api";
import { isPaywall } from "@/lib/orpc";

import { PRICING_URL } from "./pro-wall";

/** Router-level pending fallback: a quiet spinner. */
export function PageLoader() {
  const { t } = useTranslation("fitWeb");
  return (
    <div
      role="status"
      aria-label={t("state.loading")}
      className="grid min-h-[50svh] place-items-center"
    >
      <Loader2
        className="size-6 animate-spin text-muted-foreground motion-reduce:animate-[spin_1.5s_linear_infinite]"
        aria-hidden
      />
    </div>
  );
}

/** A grey block that holds a chart's or table's place while it loads. */
export function BlockSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation("fitWeb");
  return (
    <Skeleton
      role="status"
      aria-label={t("state.loading")}
      className={cn("w-full rounded-2xl", className)}
    />
  );
}

function Centered({
  icon,
  title,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-10 text-center", className)}>
      <span className="mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      {children && <div className="mt-1.5 max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A request failed (not a paywall, not a sign-out): say so and let the person try again. */
export function QueryError({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useTranslation("fitWeb");
  // Pro lapsed while the page was open: the data answers "Pro only", so this is a wall, not an outage.
  if (isPaywall(error)) {
    return (
      <Centered
        icon={<Crown className="size-5" aria-hidden />}
        title={t("wall.title")}
        className={className}
      >
        <p>{t("wall.lapsed")}</p>
        <Button className="mt-4" size="sm" nativeButton={false} render={<a href={PRICING_URL} />}>
          {t("wall.cta")}
        </Button>
      </Centered>
    );
  }
  const status = error instanceof ORPCError || error instanceof FitApiError ? error.status : 0;
  const unreachable = status === 0 || status >= 500;
  return (
    <Centered
      icon={<CloudOff className="size-5" aria-hidden />}
      title={t("state.errorTitle")}
      className={className}
    >
      <p>{unreachable ? t("state.errorUnreachable") : t("state.errorBody")}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RotateCw aria-hidden />
        {t("state.retry")}
      </Button>
    </Centered>
  );
}

export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Centered icon={<SearchX className="size-5" aria-hidden />} title={title} className={className}>
      {children}
    </Centered>
  );
}
