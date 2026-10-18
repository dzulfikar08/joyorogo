import { createFileRoute, redirect } from "@tanstack/react-router";

/** Routines moved to JoyoFit; old links land on the read-only archive. */
export const Route = createFileRoute("/_auth/latihan/rutinitas/$id")({
  beforeLoad: () => {
    throw redirect({ to: "/latihan", replace: true });
  },
});
