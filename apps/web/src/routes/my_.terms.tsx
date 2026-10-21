import { createFileRoute } from "@tanstack/react-router";

import { LegalMyPage } from "@/components/landing/my-legal";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/my_/terms")({
  component: () => <LegalMyPage path="/my/terms" />,
  head: () => pageHead("/my/terms"),
});
