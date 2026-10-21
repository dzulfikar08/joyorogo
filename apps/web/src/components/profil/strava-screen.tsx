import { Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@joyorogo/ui/components/button";
import { BrandMark } from "@/components/kit/brand-mark";
import { ListButtonRow, ListGroup, ListRow } from "@/components/kit/surface";
import {
  ConnectWithStravaButton,
  PoweredByStrava,
  StravaRetentionNotes,
  useStrava,
} from "@/components/strava-card";

/**
 * Strava connection: status head with the Strava tile, the official Connect
 * button as THE connect control, sync / disconnect once connected, Strava's
 * retention notice, and the official "Powered by Strava" logo at the bottom.
 */
export function StravaScreen() {
  const { t } = useTranslation(["settings", "common"]);
  const strava = useStrava();

  let status: string;
  let trailing: React.ReactNode = null;
  if (strava.isChecking) {
    status = t("strava.status.checking");
  } else if (strava.statusError) {
    status = t("strava.status.error", { error: strava.statusError });
    trailing = (
      <Button variant="secondary" size="xs" onClick={strava.recheck}>
        {t("common:actions.retry")}
      </Button>
    );
  } else if (!strava.configured) {
    status = t("strava.status.notConfiguredServer");
  } else if (strava.connected) {
    status = strava.athleteId
      ? t("strava.status.sectionConnectedAthlete", { id: strava.athleteId })
      : t("strava.status.sectionConnected");
    trailing = (
      <Button variant="secondary" size="sm" onClick={strava.sync} disabled={strava.isSyncing}>
        {strava.isSyncing ? t("strava.action.syncing") : t("strava.action.sync")}
      </Button>
    );
  } else {
    status = t("strava.status.idle");
  }

  const ready = strava.configured && !strava.isChecking && !strava.statusError;

  return (
    <>
      <ListGroup>
        <ListRow
          icon={<BrandMark brand="strava" />}
          title={status}
          wrapTitle
          trailing={trailing}
        />
      </ListGroup>

      {ready && !strava.connected && (
        <div className="mt-4 flex justify-center">
          <ConnectWithStravaButton onClick={strava.authorize} busy={strava.isAuthorizing} />
        </div>
      )}

      {ready && (
        <div className="mt-4 flex">
          <StravaRetentionNotes />
        </div>
      )}

      {ready && strava.connected && (
        <ListGroup className="mt-7">
          <ListButtonRow
            destructive
            icon={<Unplug aria-hidden />}
            title={
              strava.isDisconnecting
                ? t("strava.action.disconnecting")
                : t("strava.action.disconnectStrava")
            }
            onClick={strava.disconnect}
          />
        </ListGroup>
      )}

      {/* The official logo has dark lettering and must not be recolored: it sits on its own light plate so it reads in dark mode too. */}
      <div className="mt-10 flex justify-center">
        <div className="rounded-xl bg-white px-4 py-2.5">
          <PoweredByStrava className="block h-5 w-auto" />
        </div>
      </div>
    </>
  );
}
