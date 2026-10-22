import { Button } from "@joyorogo/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The one Joyo AI sparkle in the Beranda and Makan headers. It only opens the chat; the chat page decides what the account
 * can do (Pro gate, consent), so nothing is fetched from here.
 */
export function JoyoHeaderButton() {
  const { t } = useTranslation("joyoAiWeb");
  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label={t("entry.label")}
      title={t("entry.label")}
      render={<Link to="/joyo" />}
    >
      <Sparkles aria-hidden />
    </Button>
  );
}
