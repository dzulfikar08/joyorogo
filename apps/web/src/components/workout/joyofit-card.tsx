import { Dumbbell } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  JOYOFIT_ANDROID_URL,
  JOYOFIT_IOS_URL,
  JOYOFIT_SITE_URL,
  JOYOFIT_STRENGTH_LINK,
} from "@joyorogo/i18n/joyofit-links";
import { Button } from "@joyorogo/ui/components/button";

import { Card } from "@/components/kit/surface";

/** Strength training lives in JoyoFit: open it, or install it. Shared by Beranda, Olahraga and the archive. */
export function JoyoFitCard() {
  const { t } = useTranslation("olahraga");

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
          <Dumbbell className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold">{t("moved.title")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("moved.body")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11 flex-1 basis-full sm:basis-auto" render={<a href={JOYOFIT_STRENGTH_LINK} />}>
          {t("moved.open")}
        </Button>
        <Button
          variant="secondary"
          className="min-h-11 flex-1"
          render={<a href={JOYOFIT_SITE_URL} target="_blank" rel="noreferrer" />}
        >
          {t("moved.install")}
        </Button>
        <Button
          variant="secondary"
          className="min-h-11 flex-1"
          render={<a href={JOYOFIT_ANDROID_URL} target="_blank" rel="noreferrer" />}
        >
          {t("moved.android")}
        </Button>
        <Button
          variant="secondary"
          className="min-h-11 flex-1"
          render={<a href={JOYOFIT_IOS_URL} target="_blank" rel="noreferrer" />}
        >
          {t("moved.ios")}
        </Button>
      </div>
    </Card>
  );
}
