import { Activity, Unplug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import {
  GARMIN_KEY_URL,
  GarminNotes,
  useGarmin,
  useGarminConnectedNote,
} from "@/components/garmin-card";
import { IconChip, ListButtonRow, ListGroup, ListRow } from "@/components/kit/surface";

/**
 * Garmin connection: status head, then the Personal API key form until
 * connected; sync / disconnect once connected, and what is read. Syncs once on
 * open when the last sync is missing or over an hour old.
 */
export function GarminScreen() {
  const { t } = useTranslation(["garmin", "common"]);
  const garmin = useGarmin({ autoSync: true });
  const connectedNote = useGarminConnectedNote(garmin);
  const [apiKey, setApiKey] = useState("");

  let status: string;
  let trailing: React.ReactNode = null;
  if (garmin.isChecking) {
    status = t("garmin:status.checking");
  } else if (garmin.statusError) {
    status = t("garmin:status.error", { error: garmin.statusError });
    trailing = (
      <Button variant="secondary" size="xs" onClick={garmin.recheck}>
        {t("common:actions.retry")}
      </Button>
    );
  } else if (garmin.connected) {
    status = connectedNote;
    trailing = (
      <Button variant="secondary" size="sm" onClick={garmin.sync} disabled={garmin.isSyncing}>
        {garmin.isSyncing ? t("garmin:action.syncing") : t("garmin:action.sync")}
      </Button>
    );
  } else {
    status = t("garmin:status.connectHint");
  }

  const ready = garmin.configured && !garmin.isChecking && !garmin.statusError;
  const trimmed = apiKey.trim();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed || garmin.isConnecting) return;
    garmin
      .connect(trimmed)
      .then(() => setApiKey(""))
      .catch(() => {});
  };

  // Nothing renders for users off the allowlist.
  if (!garmin.isChecking && !garmin.statusError && !garmin.configured) return null;

  return (
    <>
      <ListGroup>
        <ListRow
          icon={
            <IconChip tone="bakar">
              <Activity />
            </IconChip>
          }
          title={status}
          wrapTitle
          trailing={trailing}
        />
      </ListGroup>

      {ready && !garmin.connected && (
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">
            {t("garmin:key.steps")}{" "}
            <a
              href={GARMIN_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground underline underline-offset-2"
            >
              {t("garmin:key.link")}
            </a>
          </p>
          <Input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t("garmin:key.placeholder")}
            aria-label={t("garmin:key.label")}
            aria-invalid={garmin.connectError ? true : undefined}
          />
          {garmin.connectError && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {garmin.connectError}
            </p>
          )}
          <div className="flex justify-center">
            <Button className="min-h-11" type="submit" disabled={!trimmed || garmin.isConnecting}>
              {garmin.isConnecting ? t("garmin:action.connecting") : t("garmin:action.connect")}
            </Button>
          </div>
        </form>
      )}

      {ready && (
        <div className="mt-4 flex">
          <GarminNotes />
        </div>
      )}

      {ready && garmin.connected && (
        <p className="mt-3 px-1 text-xs text-muted-foreground">{t("garmin:key.expiry")}</p>
      )}

      {ready && garmin.connected && (
        <ListGroup className="mt-7">
          <ListButtonRow
            destructive
            icon={<Unplug aria-hidden />}
            title={
              garmin.isDisconnecting
                ? t("garmin:action.disconnecting")
                : t("garmin:action.disconnect")
            }
            onClick={garmin.disconnect}
          />
        </ListGroup>
      )}
    </>
  );
}
