import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ClipboardList, Loader, Sparkles, Target } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ReflectionItem } from "@joyorogo/api/lib/recap-reflection";

import { Card, SectionTitle } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

const reflectionOptions = (weekStart: string) =>
  orpc.stats.weekReflection.queryOptions({ input: { weekStart } });

/**
 * "Refleksi minggu ini" on the weekly recap. Reads the cheap cached view; for a
 * Pro account whose AI text is due it asks the model once per visit of the week
 * and swaps the result in. Renders nothing while failing or when there is
 * nothing to say, and never blocks the rest of the recap.
 */
export function RecapReflection({ weekStart }: { weekStart: string }) {
  const { t } = useTranslation("reflection");
  const queryClient = useQueryClient();
  const reflection = useQuery(reflectionOptions(weekStart));
  const generate = useMutation(
    orpc.stats.generateWeekReflection.mutationOptions({
      onSuccess: (result) => {
        queryClient.setQueryData(reflectionOptions(weekStart).queryKey, result);
      },
    }),
  );

  const data = reflection.data;
  const requested = useRef<string | null>(null);
  const { mutate } = generate;
  const due = data?.ai === "pending";
  useEffect(() => {
    if (!due || requested.current === weekStart) return;
    requested.current = weekStart;
    mutate({ weekStart });
  }, [due, weekStart, mutate]);

  if (reflection.isPending) return <Skeleton className="h-64 rounded-3xl" />;
  if (reflection.isError || !data) return null;

  const generating = due && (generate.isPending || generate.isIdle);
  const ai = data.source === "ai";

  return (
    <Card className="p-5">
      <SectionTitle className="mb-1 px-0">{t("title")}</SectionTitle>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        {ai ? (
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        ) : (
          <ClipboardList className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0">{ai ? t("source.ai") : t("source.template")}</span>
      </p>

      <p className="mt-3 text-[0.9375rem] leading-relaxed break-words whitespace-pre-line">
        {data.text}
      </p>

      {generating ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 flex items-start gap-2 text-sm text-muted-foreground"
        >
          <Loader className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
          <span className="min-w-0">{t("generating")}</span>
        </p>
      ) : null}

      {data.wins.length > 0 || data.focus.length > 0 ? (
        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <ItemList
            heading={t("wins")}
            items={data.wins}
            icon={<Check className="size-4 text-primary" aria-hidden />}
          />
          <ItemList
            heading={t("focus")}
            items={data.focus}
            icon={<Target className="size-4 text-primary" aria-hidden />}
          />
        </div>
      ) : null}

      {data.ai === "locked" ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-semibold">{t("upsell.title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("upsell.body")}</p>
          <Button
            variant="ghost"
            className="-ml-5 mt-1 min-h-11 text-primary"
            render={<Link to="/pro" search={{ from: "banner", next: "/rekap" }} />}
          >
            {t("upsell.cta")}
          </Button>
        </div>
      ) : null}

      {data.complete ? null : (
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t("ongoing")}</p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("disclaimer")}</p>
    </Card>
  );
}

function ItemList({
  heading,
  items,
  icon,
}: {
  heading: string;
  items: ReflectionItem[];
  icon: ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-bold tracking-tight">{heading}</h3>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={`${item.code}-${item.variant}-${i}`} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0 text-sm leading-snug break-words">{item.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
