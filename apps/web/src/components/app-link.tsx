import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { appUrl } from "@/lib/app-host";

type Props = Omit<ComponentProps<"a">, "href"> & {
  to: "/login" | "/pro";
  search?: { redirect?: string };
};

/**
 * Entry point into the signed-in app from a page. On the marketing host the app lives on another origin, so this is a
 * plain link there; everywhere else it is a router link (no reload, stays inside an installed PWA's scope).
 */
export function AppLink({ to, search, ...rest }: Props) {
  const href = appUrl(to, search as Record<string, string> | undefined);
  if (href.startsWith("/")) {
    return to === "/login" ? <Link to="/login" search={search} {...rest} /> : <Link to="/pro" {...rest} />;
  }
  return <a href={href} {...rest} />;
}
