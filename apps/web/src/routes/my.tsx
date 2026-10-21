import { createFileRoute } from "@tanstack/react-router";

import { LandingMy } from "@/components/landing/landing-my";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/my")({
  component: LandingMy,
  head: () => pageHead("/my"),
});
