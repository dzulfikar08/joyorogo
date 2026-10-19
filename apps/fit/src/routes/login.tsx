import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandMark } from "@/components/brand-mark";
import { authClient, sessionQuery } from "@/lib/auth-client";
import { DEV_LOGIN } from "@/lib/env";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const raw = typeof search.redirect === "string" ? search.redirect : undefined;
    // Internal paths only: a single leading slash, no protocol-relative or absolute URLs, never a loop into /login.
    const target =
      raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login")
        ? raw
        : undefined;
    return { redirect: target };
  },
  beforeLoad: async ({ context, search }) => {
    // The login page must render even when the server is unreachable: it is the pre-auth surface.
    try {
      const session = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
      if (session) throw redirect({ to: search.redirect ?? "/" });
    } catch (error) {
      if (isRedirect(error)) throw error;
      console.warn("Session check failed; showing login anyway", error);
    }
  },
});

function LoginPage() {
  const { t } = useTranslation("fitWeb");
  const { redirect: returnTo } = Route.useSearch();
  // Absolute origin of this app: better-auth resolves a relative callbackURL against the API origin.
  const origin = window.location.origin;
  const landing = `${origin}${returnTo ?? "/"}`;

  const signInGoogle = () => {
    void authClient.signIn.social({
      provider: "google",
      callbackURL: landing,
      errorCallbackURL: `${origin}/login${returnTo ? `?redirect=${encodeURIComponent(returnTo)}` : ""}`,
    });
  };

  const signInDev = async () => {
    const { error } = await authClient.$fetch("/sign-in/dev-user", { method: "POST", body: {} });
    if (!error) window.location.href = landing;
  };

  // Review login (store reviewers): email + password, accepted server-side only for the REVIEW_LOGIN_EMAILS allowlist.
  const [emailForm, setEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signInEmail = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setEmailError(null);
    setBusy(true);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setEmailError(error.status === 429 ? t("login.rateLimited") : t("login.invalidCredentials"));
      return;
    }
    window.location.href = landing;
  };

  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <BrandMark className="size-16" />
        <h1 className="mt-5 text-[2rem] leading-tight font-extrabold tracking-tight">
          JoyoFit Web
        </h1>
        <p className="mt-2 max-w-xs text-center text-[0.9375rem] leading-relaxed text-muted-foreground">
          {t("login.tagline")}
        </p>
        <Button size="lg" className="mt-8 w-full max-w-xs" onClick={signInGoogle}>
          {/* Google brand mark: the one icon people look for on a sign-in button. */}
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
        {DEV_LOGIN && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={signInDev}>
            {t("login.dev")}
          </Button>
        )}
        {emailForm ? (
          <form onSubmit={signInEmail} className="mt-4 flex w-full max-w-xs flex-col gap-3">
            <Input
              type="email"
              autoComplete="username"
              placeholder={t("login.email")}
              aria-label={t("login.email")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Input
              type="password"
              autoComplete="current-password"
              placeholder={t("login.password")}
              aria-label={t("login.password")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {emailError && (
              <p role="alert" className="text-center text-sm text-destructive">
                {emailError}
              </p>
            )}
            <Button type="submit" variant="secondary" disabled={busy}>
              {t("login.submit")}
            </Button>
          </form>
        ) : (
          <button
            type="button"
            className="mt-4 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setEmailForm(true)}
          >
            {t("login.emailToggle")}
          </button>
        )}
      </main>
      <footer className="px-6 pb-8 text-center text-xs text-muted-foreground">
        {t("login.footer")}{" "}
        <a
          href="https://joyorogo.com/privasi"
          className="font-semibold text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          {t("login.privacy")}
        </a>
      </footer>
    </div>
  );
}
