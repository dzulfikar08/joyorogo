import { createFileRoute } from "@tanstack/react-router";

import { LegalMyPage } from "@/components/landing/my-legal";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/my_/syarat")({
  component: () => <LegalMyPage path="/my/syarat" />,
  head: () => pageHead("/my/syarat"),
});
