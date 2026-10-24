import { Unplug, Watch } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@joyorogo/ui/components/button";
import { CorosNotes, useCoros, useCorosConnectedNote } from "@/components/coros-card";
import { IconChip, ListButtonRow, ListGroup, ListRow } from "@/components/kit/surface";

/**
 * COROS connection: status head, Connect as THE connect control, sync /
 * disconnect once connected, and what is read. Syncs once on open when the
 * last sync is missing or over an hour old.
 */
export function CorosScreen() {
  const { t } = useTranslation(["coros", "common"]);
  const coros = useCoros({ autoSync: true });
  const connectedNote = useCorosConnectedNote(coros);

  let status: string;
  let trailing: React.ReactNode = null;
  if (coros.isChecking) {
    status = t("coros:status.checking");
  } else if (coros.statusError) {
    status = t("coros:status.error", { error: coros.statusError });
    trailing = (
      <Button variant="secondary" size="xs" onClick={coros.recheck}>
        {t("common:actions.retry")}
      </Button>
    );
  } else if (!coros.configured) {
    status = t("coros:status.comingSoon");
  } else if (coros.connected) {
    status = connectedNote;
    trailing = (
      <Button variant="secondary" size="sm" onClick={coros.sync} disabled={coros.isSyncing}>
        {coros.isSyncing ? t("coros:action.syncing") : t("coros:action.sync")}
      </Button>
    );
  } else {
    status = t("coros:status.connectHint");
  }

  const ready = coros.configured && !coros.isChecking && !coros.statusError;

  return (
    <>
      <ListGroup>
        <ListRow
          icon={
            <IconChip tone="bakar">
              <Watch />
            </IconChip>
          }
          title={status}
          wrapTitle
          trailing={trailing}
        />
      </ListGroup>

      {ready && !coros.connected && (
        <div className="mt-4 flex justify-center">
          <Button className="min-h-11" onClick={coros.authorize} disabled={coros.isAuthorizing}>
            {coros.isAuthorizing ? t("coros:action.connecting") : t("coros:action.connect")}
          </Button>
        </div>
      )}

      {ready && (
        <div className="mt-4 flex">
          <CorosNotes />
        </div>
      )}

      {ready && coros.connected && (
        <ListGroup className="mt-7">
          <ListButtonRow
            destructive
            icon={<Unplug aria-hidden />}
            title={
              coros.isDisconnecting ? t("coros:action.disconnecting") : t("coros:action.disconnect")
            }
            onClick={coros.disconnect}
          />
        </ListGroup>
      )}
    </>
  );
}
