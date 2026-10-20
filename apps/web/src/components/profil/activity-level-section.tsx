import type { ActivityLevel } from "@joyorogo/api/lib/engine";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ActivityLevelPicker } from "@/components/activity-level-picker";
import { ActivityRecommendations } from "@/components/activity-recommendations";
import { ErrorNote } from "@/components/kit/error-note";
import { SectionTitle } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

const guideOptions = orpc.profile.activityGuide.queryOptions();

/**
 * Level aktivitas: the five levels with this person's numbers, plus the "Lebih akurat" recommendations. Tapping a level
 * (or "Pakai") saves it at once; the plan is recomputed on the server.
 */
export function ActivityLevelSection({
  current,
  maternal,
  manualTdee = false,
}: {
  current: ActivityLevel;
  maternal: boolean;
  /** the person typed their own TDEE: the level no longer moves the target */
  manualTdee?: boolean;
}) {
  const { t } = useTranslation(["settings", "energy"]);
  const queryClient = useQueryClient();
  const guide = useQuery(guideOptions);
  const save = useMutation(
    orpc.profile.setActivityLevel.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.weight.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.fasting.key() }),
        ]);
        toast.success(t("energy:saved"));
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const applyingLevel = save.isPending ? save.variables.level : null;
  const choose = (level: ActivityLevel) => save.mutate({ level });

  return (
    <section id="activity-level" className="scroll-mt-4">
      <SectionTitle className="mt-7">{t("settings:plan.activity.title")}</SectionTitle>
      <p className="-mt-1 mb-3 px-1 text-sm leading-relaxed text-muted-foreground">
        {t("settings:plan.activity.subtitle")}
      </p>
      {manualTdee && (
        <p className="-mt-1 mb-3 rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed font-medium">
          {t("energy:manual.levelNote")}
        </p>
      )}
      {guide.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 rounded-2xl" />
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : guide.error ? (
        <ErrorNote message={guide.error.message} onRetry={() => void guide.refetch()} />
      ) : (
        <>
          <ActivityLevelPicker
            options={guide.data.options}
            value={current}
            onSelect={choose}
            maternal={maternal || guide.data.maternal}
            disabled={save.isPending}
          />
          <ActivityRecommendations
            className="mt-3"
            steps={guide.data.steps}
            calibration={guide.data.calibration}
            options={guide.data.options}
            current={current}
            applyingLevel={applyingLevel}
            onApply={choose}
            showEmpty
            autoCalibration={guide.data.autoCalibration?.enabled === true}
          />
        </>
      )}
    </section>
  );
}
