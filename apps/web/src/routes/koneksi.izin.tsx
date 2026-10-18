import { isMcpDataScope } from "@joyorogo/api/lib/mcp-scopes";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, Check, CircleAlert, Clock, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { authClient, useSession } from "@/lib/auth-client";
import { scopeKey } from "@/lib/mcp-scope-key";
import { parseOAuthRequest, readOAuthQuery } from "@/lib/oauth-query";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/koneksi/izin")({
  component: ConsentPage,
  head: () => ({
    meta: [
      { title: "Izinkan Akses | JoyoRogo" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type PublicClient = {
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
};

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("izin");
  return (
    <div className="flex min-h-svh flex-col items-center px-4 py-8 md:py-12">
      <main className="w-full max-w-md">
        <p className="mb-5 flex items-center justify-center gap-2 text-lg font-extrabold tracking-tight">
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto" />
          JoyoRogo
        </p>
        {children}
        <p className="mt-6 flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <Link
            to="/panduan/ai"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t("footer.guide")}
          </Link>
          <Link
            to="/privasi"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t("footer.privacy")}
          </Link>
        </p>
      </main>
    </div>
  );
}

function Notice({
  title,
  body,
  showGuide,
}: {
  title: string;
  body: string;
  showGuide?: boolean;
}) {
  const { t } = useTranslation("izin");
  return (
    <Card role="alert">
      <span className="flex size-9 items-center justify-center rounded-full bg-destructive/10">
        <CircleAlert className="size-[1.125rem] text-destructive" aria-hidden />
      </span>
      <h1 className="mt-3 text-xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {showGuide && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          render={<Link to="/panduan/ai" />}
        >
          <BookOpen className="size-4" aria-hidden />
          {t("invalid.guide")}
        </Button>
      )}
    </Card>
  );
}

function ConsentPage() {
  const { t } = useTranslation("izin");
  const session = useSession();
  // Read once: the signed query must be sent exactly as it arrived.
  const [request] = useState(() => parseOAuthRequest(readOAuthQuery()));

  if (!request.ok) {
    return (
      <Shell>
        <Notice
          title={
            request.reason === "expired"
              ? t("invalid.expiredTitle")
              : t("invalid.title")
          }
          body={
            request.reason === "expired"
              ? t("invalid.expiredBody")
              : t("invalid.body")
          }
          showGuide
        />
      </Shell>
    );
  }

  if (session.isPending) {
    return (
      <Shell>
        <Card aria-busy="true" aria-label={t("loading")}>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <Skeleton className="mt-6 h-11 w-full rounded-full" />
        </Card>
      </Shell>
    );
  }

  if (!session.data) {
    return (
      <Shell>
        <SignedOut request={request} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Consent request={request} email={session.data.user.email} />
    </Shell>
  );
}

function SignedOut({
  request,
}: {
  request: Extract<ReturnType<typeof parseOAuthRequest>, { ok: true }>;
}) {
  const { t } = useTranslation("izin");
  // Names the app before sign-in; the server verifies the signature and answers 400 for a forged or expired query.
  const client = useQuery({
    queryKey: ["oauth-public-client-prelogin", request.query],
    queryFn: async (): Promise<PublicClient> => {
      const { data, error } = await authClient.$fetch<PublicClient>(
        "/oauth2/public-client-prelogin",
        {
          method: "POST",
          body: { client_id: request.clientId, oauth_query: request.query },
        },
      );
      if (error || !data)
        throw Object.assign(new Error("client"), { status: error?.status });
      return data;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (client.isPending) {
    return (
      <Card aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-6 h-11 w-full rounded-full" />
      </Card>
    );
  }
  if (client.isError && (client.error as { status?: number }).status === 400) {
    return (
      <Notice title={t("invalid.title")} body={t("invalid.body")} showGuide />
    );
  }
  const name = client.data?.client_name?.trim() || t("client.unknown");
  return (
    <Card>
      <h1 className="text-xl font-extrabold tracking-tight">
        {t("signedOut.title")}
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
        {t("signedOut.body", { name, host: request.redirectHost })}
      </p>
      <Button
        size="lg"
        className="mt-5 w-full"
        render={
          <Link
            to="/login"
            search={{ redirect: `/koneksi/izin?${request.query}` }}
          />
        }
      >
        {t("signedOut.cta")}
      </Button>
    </Card>
  );
}

function Consent({
  request,
  email,
}: {
  request: Extract<ReturnType<typeof parseOAuthRequest>, { ok: true }>;
  email: string;
}) {
  const { t } = useTranslation(["izin", "koneksi"]);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const client = useQuery({
    queryKey: ["oauth-public-client", request.clientId],
    queryFn: async (): Promise<PublicClient> => {
      const { data, error: failure } = await authClient.$fetch<PublicClient>(
        "/oauth2/public-client",
        { query: { client_id: request.clientId } },
      );
      if (failure || !data) throw new Error(failure?.message ?? "client");
      return data;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const info = useQuery({
    ...orpc.mcpConnection.info.queryOptions(),
    retry: false,
  });

  const submit = async (accept: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(accept ? "allow" : "deny");
    setError(null);
    const { data, error: failure } = await authClient.$fetch<{
      redirect?: boolean;
      url?: string;
    }>("/oauth2/consent", {
      method: "POST",
      body: { accept, oauth_query: request.query },
    });
    if (failure || !data?.url) {
      const expired =
        failure?.status === 401 ||
        failure?.status === 403 ||
        failure?.status === 400;
      setError(expired ? t("izin:error.expired") : t("izin:error.consent"));
      setBusy(null);
      inFlight.current = false;
      return;
    }
    // Stay busy: the page is about to leave for the AI app.
    window.location.assign(data.url);
  };

  const scopes = request.scopes.filter(isMcpDataScope);
  const name = client.data?.client_name?.trim() || t("izin:client.unknown");
  const siteHost = hostOf(client.data?.client_uri);
  const offline = request.scopes.includes("offline_access");

  if (client.isPending) {
    return (
      <Card aria-busy="true" aria-label={t("izin:loading")}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
        <Skeleton className="mt-6 h-11 w-full rounded-full" />
      </Card>
    );
  }

  if (client.isError) {
    return (
      <Card role="alert">
        <h1 className="text-xl font-extrabold tracking-tight">
          {t("izin:client.loadError")}
        </h1>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => void client.refetch()}
        >
          {t("izin:client.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        {client.data?.logo_uri ? (
          <img
            src={client.data.logo_uri}
            alt=""
            referrerPolicy="no-referrer"
            className="size-12 shrink-0 rounded-2xl bg-muted object-cover"
          />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-lg font-extrabold text-primary">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight break-words">
            {t("izin:client.asks", { name })}
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t("izin:account", { email })}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold break-all text-foreground">
          {t("izin:client.via", { hosts: request.redirectHost })}
        </p>
        {siteHost && (
          <p className="break-all">
            {t("izin:client.site", { host: siteHost })}
          </p>
        )}
        <p className="mt-1">{t("izin:client.verify")}</p>
      </div>

      <h2 className="mt-5 text-sm font-bold">{t("izin:scopes.title")}</h2>
      {scopes.length > 0 ? (
        <ul className="mt-2 space-y-3">
          {scopes.map((scope) => (
            <li key={scope} className="flex gap-2.5">
              <Check
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden
              />
              <span className="text-sm leading-snug">
                <span className="font-semibold">
                  {t(`koneksi:scope.${scopeKey(scope)}.label`)}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {t(`koneksi:scope.${scopeKey(scope)}.desc`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("izin:scopes.none")}
        </p>
      )}
      {offline && (
        <p className="mt-3 flex gap-2.5 text-sm text-muted-foreground">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("izin:scopes.offline")}
        </p>
      )}

      <ul className="mt-5 space-y-2 text-sm leading-relaxed text-muted-foreground">
        <li className="flex gap-2.5">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden
          />
          <span className="font-semibold text-foreground">
            {t("izin:notes.readOnly")}
          </span>
        </li>
        <li>{t("izin:notes.dataFlow")}</li>
        <li>{t("izin:notes.disconnect")}</li>
        <li className="text-xs">{t("izin:notes.health")}</li>
      </ul>

      {info.data && !info.data.unlocked && (
        <div className="mt-4 rounded-2xl bg-bakar-soft p-3 text-sm leading-relaxed text-bakar-ink">
          <p>{t("izin:pro.body")}</p>
          <Link
            to="/harga"
            className="mt-1 inline-block font-semibold underline underline-offset-4"
          >
            {t("izin:pro.cta")}
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <Button
          size="lg"
          className="w-full"
          disabled={busy !== null}
          onClick={() => void submit(true)}
        >
          {busy === "allow"
            ? t("izin:actions.working")
            : t("izin:actions.allow")}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="w-full"
          disabled={busy !== null}
          onClick={() => void submit(false)}
        >
          {busy === "deny" ? t("izin:actions.working") : t("izin:actions.deny")}
        </Button>
      </div>
    </Card>
  );
}
