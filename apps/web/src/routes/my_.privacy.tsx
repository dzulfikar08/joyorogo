import { createFileRoute } from "@tanstack/react-router";

import { LegalMyPage } from "@/components/landing/my-legal";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/my_/privacy")({
  component: () => <LegalMyPage path="/my/privacy" />,
  head: () => pageHead("/my/privacy"),
});
