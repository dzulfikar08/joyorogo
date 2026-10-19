import { ALLERGENS } from "@joyorogo/api/lib/meal/types";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Chip } from "@/components/chip";
import { Segmented } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import type { MealPlanActions } from "@/components/meal-plan/use-meal-plan";
import type { MealPlanPrefs } from "@/lib/api-types";

/** The server keeps at most this many dislikes (zod max of mealPlan.setPrefs). */
const MAX_DISLIKES = 20;
const MAX_DISLIKE_LENGTH = 30;

type Cook = MealPlanPrefs["cookPref"];

function Fieldset({
  legend,
  hint,
  children,
}: {
  legend: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-[0.9375rem] font-bold">{legend}</legend>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </fieldset>
  );
}

/** Allergies, dislikes, budget and where the food comes from. After saving, offers to plan again with them. */
export function PrefsSheet({
  prefs,
  actions,
  onClose,
}: {
  prefs: MealPlanPrefs;
  actions: MealPlanActions;
  onClose: () => void;
}) {
  const { t } = useTranslation("mealPlan");
  const [draft, setDraft] = useState<MealPlanPrefs>(prefs);
  const [word, setWord] = useState("");
  const [saved, setSaved] = useState(false);
  const { setPrefs, generate } = actions;
  const full = draft.dislikes.length >= MAX_DISLIKES;

  const toggleAllergen = (allergen: MealPlanPrefs["allergens"][number]) =>
    setDraft((d) => ({
      ...d,
      allergens: d.allergens.includes(allergen)
        ? d.allergens.filter((a) => a !== allergen)
        : [...d.allergens, allergen],
    }));

  const addDislike = (event: FormEvent) => {
    event.preventDefault();
    const next = word.trim().slice(0, MAX_DISLIKE_LENGTH);
    if (next === "" || full) return;
    if (!draft.dislikes.some((d) => d.toLowerCase() === next.toLowerCase())) {
      setDraft((d) => ({ ...d, dislikes: [...d.dislikes, next] }));
    }
    setWord("");
  };

  const cookOptions: Array<{ value: Cook; label: string }> = [
    { value: "cook", label: t("prefs.cookCook") },
    { value: "buy", label: t("prefs.cookBuy") },
    { value: "mixed", label: t("prefs.cookMixed") },
  ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("prefs.title")}
    >
      {saved ? (
        <div className="space-y-4">
          <p role="status" className="text-[0.9375rem] leading-relaxed">
            {t("prefs.saved")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="sm:flex-1"
              disabled={generate.isPending}
              onClick={() => generate.mutate(true, { onSuccess: onClose })}
            >
              {generate.isPending && (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
              )}
              {generate.isPending ? t("regen.working") : t("prefs.regenNow")}
            </Button>
            <Button
              variant="ghost"
              className="sm:flex-1"
              disabled={generate.isPending}
              onClick={onClose}
            >
              {t("prefs.later")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <Fieldset legend={t("prefs.allergies")} hint={t("prefs.allergiesHint")}>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map((allergen) => (
                <Chip
                  key={allergen}
                  active={draft.allergens.includes(allergen)}
                  onClick={() => toggleAllergen(allergen)}
                >
                  {t(`allergen.${allergen}`)}
                </Chip>
              ))}
            </div>
          </Fieldset>

          <Fieldset legend={t("prefs.dislikes")} hint={t("prefs.dislikesHint")}>
            <form onSubmit={addDislike} className="flex gap-2">
              <Input
                aria-label={t("prefs.dislikes")}
                value={word}
                onChange={(event) => setWord(event.target.value)}
                maxLength={MAX_DISLIKE_LENGTH}
                placeholder={t("prefs.dislikesPlaceholder")}
                disabled={full}
                enterKeyHint="done"
              />
              <Button type="submit" variant="secondary" disabled={full || word.trim() === ""}>
                {t("prefs.dislikesAdd")}
              </Button>
            </form>
            {full && (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("web.dislikesLimit", { max: MAX_DISLIKES })}
              </p>
            )}
            {draft.dislikes.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {draft.dislikes.map((name) => (
                  <li
                    key={name}
                    className="flex max-w-full items-center rounded-full bg-muted pl-4 text-sm font-semibold"
                  >
                    <span className="min-w-0 py-2 break-words">{name}</span>
                    <button
                      type="button"
                      aria-label={t("prefs.dislikesRemove", { name })}
                      onClick={() =>
                        setDraft((d) => ({ ...d, dislikes: d.dislikes.filter((x) => x !== name) }))
                      }
                      className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Fieldset>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-bold">{t("prefs.budget")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("prefs.budgetHint")}</p>
            </div>
            <Switch
              label={t("prefs.budget")}
              checked={draft.budgetFriendly}
              onCheckedChange={(budgetFriendly) => setDraft((d) => ({ ...d, budgetFriendly }))}
            />
          </div>

          <Fieldset legend={t("prefs.cook")} hint={t("prefs.cookHint")}>
            <Segmented
              label={t("prefs.cook")}
              value={draft.cookPref}
              onChange={(cookPref) => setDraft((d) => ({ ...d, cookPref }))}
              options={cookOptions}
              className="[&>button]:min-h-11"
            />
          </Fieldset>

          {setPrefs.isError && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {setPrefs.error.message}
            </p>
          )}
          <Button
            className="w-full"
            disabled={setPrefs.isPending}
            onClick={() => setPrefs.mutate(draft, { onSuccess: () => setSaved(true) })}
          >
            {setPrefs.isPending && (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {t("prefs.save")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
