import { createFileRoute } from "@tanstack/react-router";

import { LegalMyPage } from "@/components/landing/my-legal";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/my_/privasi")({
  component: () => <LegalMyPage path="/my/privasi" />,
  head: () => pageHead("/my/privasi"),
});
