import { Outlet, createFileRoute } from "@tanstack/react-router";

/** Layout for the Profil hub (`/profil`), its sub-screens and the Strava OAuth return. */
export const Route = createFileRoute("/_auth/profil")({
  component: Outlet,
});
