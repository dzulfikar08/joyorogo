import { createFileRoute, redirect } from "@tanstack/react-router";

/** The logger moved to JoyoFit; old links land on the read-only archive. */
export const Route = createFileRoute("/_auth/latihan/aktif")({
  beforeLoad: () => {
    throw redirect({ to: "/latihan", replace: true });
  },
});
