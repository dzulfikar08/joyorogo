import { useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { Globe, Image as ImageIcon, Link2, Mic, ShieldCheck, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { IconChip, ListButtonRow, ListGroup, ListLinkRow, ListRow } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { useAccountActions } from "@/components/profil/account-actions";
import { ConfirmSheet } from "@/components/profil/confirm-sheet";
import { profileOptions } from "@/components/profil/shared";
import { SleepConsentSection } from "@/components/sleep-insights/consent";
import type { ProfilCtx } from "@/components/profil/shared";
import { env } from "@/env.public";
import type { MyProfileData } from "@/lib/api-types";
import { legalPath } from "@/lib/legal-path";
import { saveScanSimple, storedScanSimple } from "@/lib/scan-simple";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { client, getServerUrl, orpc } from "@/utils/orpc";

/** Public progress page, original photos, policy link, and wipe-all-data at the bottom. */
export function PrivacyScreen({ ctx }: { ctx: ProfilCtx }) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const { row, targets } = ctx;
  const actions = useAccountActions();
  return (
    <>
      {!targets.maternal && <ShareSection enabled={row.shareEnabled} code={row.shareCode} />}
      <KeepPhotosSection keep={row.keepPhotos} />
      <ScanSimpleSection />
      <SleepConsentSection />
      <ListGroup className="mt-3">
        <ListLinkRow
          to={legalPath("privacy", i18n.language)}
          icon={
            <IconChip tone="makan">
              <ShieldCheck />
            </IconChip>
          }
          title={t("privacy.policy")}
        />
      </ListGroup>

      <ListGroup className="mt-7">
        <ListButtonRow
          destructive
          icon={<Trash2 aria-hidden />}
          title={t("privacy.wipe.title")}
          subtitle={t("privacy.wipe.subtitleWeb")}
          onClick={() => actions.setWipeOpen(true)}
        />
      </ListGroup>
      <ConfirmSheet
        open={actions.wipeOpen}
        onOpenChange={actions.setWipeOpen}
        title={t("privacy.wipe.confirmTitle")}
        description={t("privacy.wipe.confirmDescription")}
        body={t("privacy.wipe.confirmBodyWeb")}
        confirmLabel={actions.wiping ? t("privacy.wipe.deleting") : t("privacy.wipe.confirmAction")}
        pending={actions.wiping}
        onConfirm={actions.wipeData}
      />
    </>
  );
}

function ShareSection({ enabled, code }: { enabled: boolean; code: string | null }) {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const previous = useRef<boolean | null>(null);
  const toggle = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["shareToggle"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.shareToggle(input),
    patch: (input, cache) => {
      previous.current = enabled;
      cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
        data?.profile ? { ...data, profile: { ...data.profile, publicPage: input.enabled } } : data,
      );
    },
    invalidate: () => [orpc.profile.key()],
    success: (input) => {
      const prev = previous.current;
      previous.current = null;
      return {
        message: input.enabled ? t("privacy.share.toastOn") : t("privacy.share.toastOff"),
        undo: prev === null ? undefined : () => void client.profile.shareToggle({ enabled: prev }),
      };
    },
  });
  const link = code ? `${getServerUrl(env.VITE_SERVER_URL)}/u/${code}` : null;

  return (
    <ListGroup>
      <ListRow
        icon={
          <IconChip tone="tidur">
            <Globe />
          </IconChip>
        }
        title={t("privacy.share.titleWeb")}
        subtitle={t("privacy.share.hintWeb")}
        trailing={
          <Switch
            label={t("privacy.share.titleWeb")}
            checked={enabled}
            disabled={toggle.isPending}
            onCheckedChange={(next) => toggle.mutate({ enabled: next })}
          />
        }
      />
      {enabled && link && (
        <ListButtonRow
          icon={
            <IconChip tone="muted">
              <Link2 />
            </IconChip>
          }
          title={t("privacy.share.copyLink")}
          value={`/u/${code}`}
          onClick={() => {
            void navigator.clipboard.writeText(link);
            toast.success(t("privacy.share.copied"));
          }}
        />
      )}
    </ListGroup>
  );
}

function ScanSimpleSection() {
  const { t } = useTranslation("settings");
  const [on, setOn] = useState(storedScanSimple);
  return (
    <ListGroup className="mt-3">
      <ListRow
        icon={
          <IconChip tone="makan">
            <Mic />
          </IconChip>
        }
        title={t("scanSimple.title")}
        subtitle={on ? t("scanSimple.on") : t("scanSimple.off")}
        trailing={
          <Switch
            label={t("scanSimple.label")}
            checked={on}
            onCheckedChange={(next) => {
              setOn(next);
              saveScanSimple(next);
            }}
          />
        }
      />
    </ListGroup>
  );
}

function KeepPhotosSection({ keep }: { keep: boolean }) {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const patchKeep = (cache: OptimisticCache, value: boolean) => {
    cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
      data?.profile ? { ...data, profile: { ...data.profile, keepPhotos: value } } : data,
    );
  };
  // keep=true is a safe instant edit; keep=false destroys stored photos
  // server-side, so the destructive call is delayed behind the undo window.
  const previousKeep = useRef<boolean | null>(null);
  const setKeep = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["setKeepPhotos"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.setKeepPhotos(input),
    patch: (input, cache) => {
      if (input.keep) {
        previousKeep.current = keep;
        patchKeep(cache, true);
      }
    },
    invalidate: () => [orpc.profile.key(), orpc.food.key()],
    success: (input) => {
      if (!input.keep) return undefined;
      const prev = previousKeep.current;
      previousKeep.current = null;
      if (prev === false) {
        return {
          message: t("privacy.keepPhotos.toast"),
          undo: () => void client.profile.setKeepPhotos({ keep: false }),
        };
      }
      return { message: t("privacy.keepPhotos.toast") };
    },
  });
  // Delayed commit for the destructive keep=false branch.
  const disableKeep = useDelayedDelete<{ id: string }>({
    remove: () => client.profile.setKeepPhotos({ keep: false }),
    patch: (_row, cache) => {
      patchKeep(cache, false);
    },
    label: () => t("privacy.keepPhotos.label"),
    fallback: t("privacy.keepPhotos.label"),
    invalidate: () => [orpc.profile.key(), orpc.food.key()],
  });
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <>
      <ListGroup className="mt-3">
        <ListRow
          icon={
            <IconChip tone="makan">
              <ImageIcon />
            </IconChip>
          }
          title={t("privacy.keepPhotos.title")}
          subtitle={keep ? t("privacy.keepPhotos.onWeb") : t("privacy.keepPhotos.offWeb")}
          trailing={
            <Switch
              label={t("privacy.keepPhotos.title")}
              checked={keep}
              onCheckedChange={(next) =>
                next ? setKeep.mutate({ keep: true }) : setConfirmOff(true)
              }
            />
          }
        />
      </ListGroup>
      <Sheet
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t("privacy.keepPhotos.confirm.title")}
        description={t("privacy.keepPhotos.confirm.descriptionWeb")}
      >
        <div className="space-y-4">
          <p className="text-[0.9375rem] leading-relaxed">
            {t("privacy.keepPhotos.confirm.bodyWeb")}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => {
                setConfirmOff(false);
                disableKeep({ id: "keep-photos" });
              }}
            >
              {t("privacy.keepPhotos.confirm.actionWeb")}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={setKeep.isPending}
              onClick={() => setConfirmOff(false)}
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
