import { createFileRoute } from "@tanstack/react-router";

import { LandingSg } from "@/components/landing/landing-sg";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/sg")({
  component: LandingSg,
  head: () => pageHead("/sg"),
});
