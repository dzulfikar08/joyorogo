import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Baby, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { MaternalInfo } from "@joyorogo/api/lib/maternal";
import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";

import { ListButtonRow, IconChip } from "@/components/kit/surface";
import type { ProfileRow } from "@/lib/api-types";
import { fmtDateLong } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { MaternalDisclaimer } from "./disclaimer";
import { EndPregnancySheetBody } from "./end-pregnancy-sheet";
import { MaternalFlagNotes } from "./flag-notes";
import {
  emptyMaternalDraft,
  MaternalForm,
  maternalDraftFromRow,
  maternalDraftToInput,
} from "./maternal-form";
import type { MaternalDraft, MaternalDraftMode } from "./maternal-form";
import { useMaternalStageLine } from "./use-maternal";

type View = "main" | "form" | "end" | "off";

/** Settings > Profile: the "Hamil dan menyusui" row and the sheet behind it (setup, edit, Sudah melahirkan, turn off). */
export function MaternalSettings({
  row,
  info,
  defaultOpen = false,
  onClosed,
}: {
  row: ProfileRow;
  info: MaternalInfo | null;
  defaultOpen?: boolean;
  onClosed?: () => void;
}) {
  const { t } = useTranslation(["maternal", "common", "settings"]);
  const queryClient = useQueryClient();
  const stageLine = useMaternalStageLine();
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<View>("main");
  const [draft, setDraft] = useState<MaternalDraft>(() => emptyMaternalDraft("pregnant"));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation(
    orpc.profile.setMaternal.mutationOptions({
      onSuccess: (_data, input) => {
        queryClient.invalidateQueries();
        toast.success(input.mode === "none" ? t("maternal:settings.turnedOff") : t("maternal:settings.saved"));
        setView("main");
        if (input.mode === "none") close();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const close = () => {
    setOpen(false);
    setView("main");
    setError(null);
    onClosed?.();
  };
  const patch = (next: Partial<MaternalDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  };
  const startSetup = (mode: MaternalDraftMode) => {
    setDraft(emptyMaternalDraft(mode));
    setError(null);
    setView("form");
  };
  const startEdit = () => {
    setDraft(maternalDraftFromRow(row) ?? emptyMaternalDraft("pregnant"));
    setError(null);
    setView("form");
  };
  const submit = () => {
    const result = maternalDraftToInput(draft);
    if (!result.ok) {
      setError(t(`maternal:form.error.${result.error}`));
      return;
    }
    save.mutate(result.input);
  };

  const rowSubtitle = !info
    ? t("maternal:settings.rowOff")
    : info.mode === "pregnant"
      ? t("maternal:settings.rowPregnant", { week: info.gestation?.weeks ?? 0 })
      : t("maternal:settings.rowBreastfeeding", { months: info.babyMonths ?? 0 });

  const title =
    view === "form"
      ? t(draft.mode === "pregnant" ? "maternal:form.pregnantTitle" : "maternal:form.breastfeedingTitle")
      : view === "end"
        ? t("maternal:end.title")
        : view === "off"
          ? t("maternal:settings.turnOffTitle")
          : t("maternal:settings.title");
  const description =
    view === "end"
      ? t("maternal:end.body")
      : view === "main" && !info
        ? t("maternal:entry.hint")
        : undefined;

  return (
    <>
      <ListButtonRow
        icon={
          <IconChip tone="makan">
            <Baby />
          </IconChip>
        }
        title={t("maternal:settings.title")}
        subtitle={rowSubtitle}
        onClick={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else close();
        }}
        title={title}
        description={description}
      >
        {view === "main" && !info && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">{t("maternal:settings.intro")}</p>
            <div className="space-y-2">
              {(["pregnant", "breastfeeding"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => startSetup(mode)}
                  className="pressable flex w-full items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-bold">{t(`maternal:entry.${mode}`)}</span>
                    <span className="block text-sm text-muted-foreground">
                      {t(`maternal:entry.${mode}Hint`)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <MaternalDisclaimer />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("maternal:privacy.note")}</p>
          </div>
        )}

        {view === "main" && info && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-makan-soft p-4">
              <p className="text-lg leading-tight font-extrabold tracking-tight text-makan-ink">
                {stageLine(info)}
              </p>
              {info.mode === "pregnant" && info.gestation && (
                <p className="mt-1.5 text-sm tabular-nums">
                  {t("maternal:summary.due", {
                    date: fmtDateLong(info.gestation.dueDate).replace(/^\w+, /, ""),
                  })}
                  {" · "}
                  {info.gestation.daysToDue >= 0
                    ? t("maternal:summary.daysToDue", { days: info.gestation.daysToDue })
                    : t("maternal:summary.pastDue", { days: -info.gestation.daysToDue })}
                </p>
              )}
              {info.twins && <p className="mt-0.5 text-sm">{t("maternal:summary.twins")}</p>}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("maternal:settings.intro")}</p>
            <MaternalFlagNotes info={info} />
            <div className="flex flex-col gap-2">
              <Button variant="secondary" className="w-full" onClick={startEdit}>
                <Pencil className="size-4" aria-hidden />
                {t("maternal:settings.edit")}
              </Button>
              {info.mode === "pregnant" && (
                <Button variant="secondary" className="w-full" onClick={() => setView("end")}>
                  {t("maternal:end.button")}
                </Button>
              )}
              <Button variant="ghost" className="w-full text-destructive" onClick={() => setView("off")}>
                {t("maternal:settings.turnOff")}
              </Button>
            </div>
            <MaternalDisclaimer />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("maternal:privacy.note")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("maternal:settings.hiddenNote")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("maternal:settings.ramadanNote")}</p>
          </div>
        )}

        {view === "form" && (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <MaternalForm draft={draft} onChange={patch} />
            <MaternalDisclaimer />
            {error && (
              <p role="alert" className="text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={save.isPending}>
                {save.isPending ? t("settings:state.saving") : t("maternal:form.save")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={save.isPending}
                onClick={() => setView("main")}
              >
                {t("common:actions.cancel")}
              </Button>
            </div>
          </form>
        )}

        {view === "end" && <EndPregnancySheetBody onClose={close} />}

        {view === "off" && (
          <div className="space-y-4">
            <p className="text-[0.9375rem] leading-relaxed">{t("maternal:settings.turnOffBody")}</p>
            <div className="flex flex-col gap-2">
              <Button
                variant="destructive"
                className="w-full"
                disabled={save.isPending}
                onClick={() => save.mutate({ mode: "none" })}
              >
                {save.isPending ? t("settings:state.saving") : t("maternal:settings.turnOffConfirm")}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                disabled={save.isPending}
                onClick={() => setView("main")}
              >
                {t("common:actions.cancel")}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
