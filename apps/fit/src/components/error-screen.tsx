import { Button } from "@joyorogo/ui/components/button";
import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { BrandMark } from "./brand-mark";

// A chunk-load error means a tab from before a deploy is asking for assets that are gone: only a reload recovers.
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|importing a module script|loading chunk \d+ failed|chunkloaderror/i.test(
    message,
  );
}

function Screen({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 py-12 text-center text-foreground">
      <BrandMark className="size-12" />
      <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div>
    </div>
  );
}

export function ErrorScreen({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation("fitWeb");
  const stale = isChunkLoadError(error);
  return (
    <Screen
      title={stale ? t("error.updatedTitle") : t("error.title")}
      body={stale ? t("error.updatedBody") : t("error.body")}
    >
      <Button onClick={() => (stale ? window.location.reload() : reset())}>
        {stale ? t("error.reload") : t("state.retry")}
      </Button>
    </Screen>
  );
}

export function NotFoundScreen() {
  const { t } = useTranslation("fitWeb");
  return (
    <Screen title={t("notFound.title")} body={t("notFound.body")}>
      <Button nativeButton={false} render={<Link to="/" />}>
        {t("notFound.home")}
      </Button>
    </Screen>
  );
}
