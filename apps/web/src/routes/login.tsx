import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, isRedirect, Link, redirect } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Mascot } from "@/components/mascot";
import { markSignInStart } from "@/lib/analytics";
import { authClient, sessionQuery } from "@/lib/auth-client";
import { legalPath } from "@/lib/legal-path";
import { restoreAccountPrefs } from "@/lib/prefs-sync";
import { pageHead } from "@/lib/seo";
import { orpc } from "@/utils/orpc";
import { env } from "@/env.public";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
  head: () => pageHead("/login"),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const raw = typeof search.redirect === "string" ? search.redirect : undefined;
    // Internal paths only: a single leading slash, no protocol-relative or
    // absolute URLs, and never a loop back into /login.
    const redirect =
      raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login")
        ? raw
        : undefined;
    return { redirect };
  },
  beforeLoad: async ({ context, search }) => {
    // The login page must render even when the server is unreachable —
    // it is the pre-auth surface, not somewhere an error boundary helps.
    try {
      const session = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
      if (session) {
        // The account's theme and other choices are in place before the app opens (bounded, never blocks long).
        await restoreAccountPrefs(session.user.id);
        // A return path with its own query (the AI consent page) must not pass through router
        // search parsing, which would rewrite the signed values.
        if (search.redirect?.includes("?")) {
          throw redirect({ href: `${window.location.origin}${search.redirect}` });
        }
        throw redirect({ to: search.redirect ?? "/beranda" });
      }
    } catch (error) {
      if (isRedirect(error)) throw error;
      console.warn("Session check failed; showing login anyway", error);
    }
  },
});

function RouteComponent() {
  const { t, i18n } = useTranslation("auth");
  const isPending = false;
  const { redirect: returnTo } = Route.useSearch();

  // Absolute web-origin URLs: better-auth resolves relative callbackURLs
  // against the API origin (server baseURL), which would land users on the
  // API instead of the app.
  const webOrigin = window.location.origin;

  const signInGoogle = () => {
    markSignInStart();
    authClient.signIn.social({
      provider: "google",
      callbackURL: `${webOrigin}${returnTo ?? "/beranda"}`,
      errorCallbackURL: `${webOrigin}/login${returnTo ? `?redirect=${encodeURIComponent(returnTo)}` : ""}`,
    });
  };
  const signInDev = async () => {
    // $fetch resolves { data, error } without throwing on HTTP errors
    const { error } = await authClient.$fetch("/sign-in/dev-user", {
      method: "POST",
      body: {},
    });
    if (!error) {
      window.location.href = `${webOrigin}${returnTo ?? "/"}`;
    }
  };

  // Review login (Google Play / App Store reviewers): email + password, only
  // accepted server-side for the REVIEW_LOGIN_EMAILS allowlist.
  const [emailForm, setEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const signInEmail = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setEmailError(null);
    setEmailBusy(true);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setEmailBusy(false);
    if (error) {
      setEmailError(
        error.status === 429 ? t("login.error.rateLimited") : t("login.error.invalidCredentials"),
      );
      return;
    }
    window.location.href = `${webOrigin}${returnTo ?? "/beranda"}`;
  };

  // Invite links land here first; naming the group keeps the sign-in from feeling generic.
  const inviteCode = returnTo?.match(/^\/gabung\/([A-Za-z0-9]{4,20})$/)?.[1];
  const invite = useQuery({
    ...orpc.group.preview.queryOptions({ input: { code: inviteCode ?? "" } }),
    enabled: inviteCode !== undefined,
    retry: false,
  });

  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <Mascot pose="hero" size="md" eager />
        <h1 className="mt-5 text-[2rem] leading-tight font-extrabold tracking-tight">JoyoRogo</h1>
        <p className="mt-2 max-w-xs text-center text-[0.9375rem] leading-relaxed text-muted-foreground">
          {t("login.tagline")}
        </p>
        {invite.data && (
          <div className="mt-6 flex w-full max-w-xs items-center gap-3 rounded-2xl bg-card p-3 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Users className="size-5 text-primary" aria-hidden />
            </span>
            <p className="min-w-0 text-sm text-muted-foreground">
              {t("login.invite")}
              <span className="block truncate text-base font-extrabold text-foreground">
                {invite.data.name}
              </span>
            </p>
          </div>
        )}
        <Button
          size="lg"
          className="mt-8 w-full max-w-xs"
          onClick={signInGoogle}
          data-revklik-goal="google_signin"
          disabled={isPending}
        >
          {/* Google brand mark; the one icon users look for on a sign-in button. */}
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
            />
          </svg>
          {t("login.google")}
        </Button>
        {/* Vite dev server only: production builds drop this even if .env sets the flag. */}
        {import.meta.env.DEV && env.VITE_DEV_LOGIN === "1" && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={signInDev}>
            {t("login.dev")}
          </Button>
        )}
        {emailForm ? (
          <form onSubmit={signInEmail} className="mt-4 flex w-full max-w-xs flex-col gap-3">
            <Input
              type="email"
              autoComplete="username"
              placeholder={t("login.email.emailLabel")}
              aria-label={t("login.email.emailLabel")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Input
              type="password"
              autoComplete="current-password"
              placeholder={t("login.email.passwordLabel")}
              aria-label={t("login.email.passwordLabel")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {emailError && (
              <p role="alert" className="text-center text-sm text-destructive">
                {emailError}
              </p>
            )}
            <Button type="submit" variant="secondary" disabled={emailBusy}>
              {t("login.email.submit")}
            </Button>
          </form>
        ) : (
          <button
            type="button"
            className="mt-4 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setEmailForm(true)}
          >
            {t("login.email.toggle")}
          </button>
        )}
      </main>
      <footer className="pb-8 text-center">
        <p className="text-xs text-muted-foreground">
          <Trans
            ns="auth"
            i18nKey="login.privacyNote"
            components={{
              link: (
                <Link
                  to={legalPath("privacy", i18n.language)}
                  className="font-semibold text-foreground underline underline-offset-4 hover:text-foreground/80"
                />
              ),
            }}
          />
        </p>
      </footer>
    </div>
  );
}
