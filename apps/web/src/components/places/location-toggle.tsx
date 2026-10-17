import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Switch } from "@/components/kit/switch";
import type { LocationStatus } from "@/lib/location";

const HINT_KEY = {
  off: "toggle.hint.off",
  locating: "toggle.hint.locating",
  ready: "toggle.hint.ready",
  denied: "toggle.hint.deniedWeb",
  unavailable: "toggle.hint.unavailable",
} as const satisfies Record<LocationStatus, string>;

/** Opt-in switch under the place field; state comes from usePlaceLocation(). */
export function SaveLocationToggle({
  enabled,
  status,
  onChange,
}: {
  enabled: boolean;
  status: LocationStatus;
  onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation("place");
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted/60 px-4 py-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-makan-soft">
        <MapPin className="size-[1.125rem] text-makan-ink" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold">{t("toggle.title")}</p>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground" aria-live="polite">
          {t(HINT_KEY[enabled ? status : "off"])}
        </p>
      </div>
      <div className="pt-2">
        <Switch checked={enabled} onCheckedChange={onChange} label={t("toggle.title")} />
      </div>
    </div>
  );
}
