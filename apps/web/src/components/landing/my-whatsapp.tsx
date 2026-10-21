import { MessageCircle } from "lucide-react";

import { cn } from "@joyorogo/ui/lib/utils";

import {
  WHATSAPP_DISPLAY,
  WHATSAPP_MESSAGE_EN,
  WHATSAPP_MESSAGE_MS,
  whatsappUrl,
} from "@/lib/contact";

/**
 * Support link to the company WhatsApp, with the opening message prefilled in the page's language. The label is
 * always "WhatsApp" plus the number, so nobody has to open the link to learn who they would be writing to.
 * `location` names the spot for the Revklik goal.
 */
export function WhatsAppLink({
  location,
  lang = "ms",
  className,
}: {
  location: string;
  lang?: "ms" | "en";
  className?: string;
}) {
  return (
    <a
      href={whatsappUrl(lang === "en" ? WHATSAPP_MESSAGE_EN : WHATSAPP_MESSAGE_MS)}
      target="_blank"
      rel="noopener"
      data-revklik-goal="whatsapp_click"
      data-revklik-goal-location={location}
      className={cn(
        "rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        className,
      )}
    >
      <MessageCircle className="size-4" aria-hidden />
      WhatsApp {WHATSAPP_DISPLAY}
    </a>
  );
}
