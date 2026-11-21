import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, Home } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AppLink } from "@/components/app-link";
import { trackEvent } from "@/lib/analytics";
import { useSession } from "@/lib/auth-client";
import { fmtFounderDate, usePolarPortal } from "@/lib/billing";
import { pageHead } from "@/lib/seo";
import { orpc } from "@/utils/orpc";

// Joyo Keluarga seat invite (docs/pricing/joyo-keluarga.md section 2). No auth gate: the invitee sees whose household
// it is before signing in. Accepting needs a session; before that, someone who pays Pro themselves is told whether
// their own subscription renews and where to cancel it.
export const Route = createFileRoute("/keluarga/$code")({
  component: KeluargaInvitePage,
  head: () => pageHead("/keluarga"),
});

function KeluargaInvitePage() {
  const { t } = useTranslation("keluarga");
  const { code } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useSession();
  const portal = usePolarPortal();

  const valid = /^[A-Za-z0-9]{4,20}$/.test(code);
  const preview = useQuery({
    ...orpc.household.preview.queryOptions({ input: { code } }),
    enabled: valid && !session.isPending,
    retry: false,
  });

  const accept = useMutation(
    orpc.household.accept.mutationOptions({
      onSuccess: ({ already }) => {
        if (!already) trackEvent("keluarga_invite_accepted");
        void queryClient.invalidateQueries({ queryKey: orpc.household.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
        toast.success(t("invite.joined"));
        void navigate({ to: "/profil/langganan" });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const signedIn = Boolean(session.data);
  const data = preview.data;
  const ownPro = data?.viewer?.ownPro ?? null;
  const membership = data?.viewer?.membership ?? null;

  let content: React.ReactNode;
  if (!valid) {
    content = <Problem title={t("invite.invalidTitle")} body={t("invite.invalidBody")} />;
  } else if (preview.isPending) {
    content = (
      <div aria-busy="true" aria-label={t("invite.checking")}>
        <Skeleton className="mx-auto h-12 w-12 rounded-full" />
        <Skeleton className="mx-auto mt-3 h-6 w-48" />
        <Skeleton className="mx-auto mt-2 h-4 w-28" />
        <Skeleton className="mx-auto mt-5 h-12 w-full rounded-full" />
      </div>
    );
  } else if (preview.isError || !data) {
    content = <Problem title={preview.error?.message ?? t("invite.invalidTitle")} />;
  } else {
    const state = data.state;
    const blocked = state !== "ok" && membership !== "this";
    content = (
      <>
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Home className="size-6 text-primary" aria-hidden />
        </span>
        <h1 className="mt-3 text-xl font-extrabold tracking-tight text-balance">
          {t("invite.invitedBy", { name: data.ownerFirstName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {t("invite.seats", { used: data.seatsUsed, count: data.seats })}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("invite.pitch")}</p>

        {membership === "this" ? (
          <>
            <p className="mt-4 rounded-2xl bg-muted px-3 py-2 text-sm leading-snug">{t("invite.already")}</p>
            <Button className="mt-5 w-full" render={<Link to="/profil/langganan" />}>
              {t("invite.open")}
            </Button>
          </>
        ) : blocked ? (
          <p role="alert" className="mt-4 rounded-2xl bg-muted px-3 py-2 text-sm leading-snug">
            {t(`server.error.invite_${state as Exclude<typeof state, "ok">}`)}
          </p>
        ) : membership === "other" ? (
          <>
            <p role="alert" className="mt-4 rounded-2xl bg-muted px-3 py-2 text-sm leading-snug">
              {t("invite.other")}
            </p>
            <Button variant="secondary" className="mt-5 w-full" render={<Link to="/profil/langganan" />}>
              {t("invite.open")}
            </Button>
          </>
        ) : (
          <>
            {ownPro && (
              <div className="mt-4 rounded-2xl bg-muted px-3 py-2 text-left text-sm leading-snug">
                <p>
                  {ownPro.renews === "polar"
                    ? t("invite.ownPro.polar")
                    : ownPro.renews
                      ? t("invite.ownPro.store")
                      : t("invite.ownPro.web", { date: fmtFounderDate(ownPro.until ?? new Date()) })}
                </p>
                {ownPro.renews === "polar" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    disabled={portal.isPending}
                    onClick={() => portal.mutate(undefined, { onError: (error) => toast.error(error.message) })}
                  >
                    {t("invite.ownPro.manage")}
                  </Button>
                )}
              </div>
            )}
            {signedIn ? (
              <Button
                size="lg"
                className="mt-5 w-full"
                disabled={accept.isPending}
                onClick={() => accept.mutate({ code })}
              >
                {accept.isPending ? t("invite.joining") : t("invite.join")}
              </Button>
            ) : (
              <>
                <Button
                  size="lg"
                  className="mt-5 w-full"
                  render={<AppLink to="/login" search={{ redirect: `/keluarga/${code}` }} />}
                >
                  {t("invite.signIn")}
                </Button>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("invite.signInHint")}</p>
              </>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <img src="/brand/joyo-head.webp" alt="" width={104} height={96} className="h-16 w-auto" />
        <div className="mt-6 w-full max-w-sm rounded-3xl bg-card p-6 text-center">{content}</div>
      </main>
    </div>
  );
}

function Problem({ title, body }: { title: string; body?: string }) {
  const { t } = useTranslation("keluarga");
  return (
    <>
      <CircleAlert className="mx-auto size-8 text-destructive" aria-hidden />
      <h1 className="mt-3 text-lg font-extrabold tracking-tight">{title}</h1>
      {body && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>}
      <Button render={<Link to="/" />} variant="secondary" className="mt-5 w-full">
        {t("invite.openApp")}
      </Button>
    </>
  );
}
