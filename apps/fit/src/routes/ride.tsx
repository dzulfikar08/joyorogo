import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { RIDE_URL } from "@/lib/ride";

/** Public, outside the `_auth` guard: the ride game is a separate full-screen site, so this only forwards there. */
export const Route = createFileRoute("/ride")({ component: RideRedirect });

function RideRedirect() {
  const { t } = useTranslation("fitWeb");
  useEffect(() => {
    window.location.replace(RIDE_URL);
  }, []);
  return (
    <div className="grid min-h-svh place-items-center p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {t("ride.opening")}{" "}
        <a className="font-semibold text-primary underline" href={RIDE_URL}>
          {t("ride.openNow")}
        </a>
      </p>
    </div>
  );
}
