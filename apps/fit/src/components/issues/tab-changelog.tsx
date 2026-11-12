import { useQuery } from "@tanstack/react-query";
import { ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import { changelogQuery } from "@/lib/issues";

import { useFmtDate } from "./shared";

/** Ideas the team finished, newest first. */
export default function ChangelogTab({ openIdea }: { openIdea: (id: string) => void }) {
  const { t } = useTranslation("fitWebIssues");
  const fmtDate = useFmtDate();
  const log = useQuery(changelogQuery);

  if (log.isPending) return <BlockSkeleton className="h-64" />;
  if (log.isError) return <QueryError error={log.error} onRetry={() => void log.refetch()} />;
  if (log.data.results.length === 0) {
    return (
      <Card>
        <EmptyState title={t("changelog.empty")}>
          <p>{t("changelog.emptyBody")}</p>
        </EmptyState>
      </Card>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {log.data.results.map((entry) => (
        <li key={entry.id}>
          <Card className="p-3 sm:p-4">
            <button
              type="button"
              onClick={() => openIdea(entry.id)}
              className="w-full rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span className="block text-xs font-semibold text-muted-foreground">
                {fmtDate(entry.completed_at)}
              </span>
              <span className="mt-0.5 block font-semibold leading-snug">{entry.name}</span>
              {entry.description && (
                <span className="mt-0.5 line-clamp-3 block text-sm text-muted-foreground">
                  {entry.description}
                </span>
              )}
              {entry.votes > 0 && (
                <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ChevronUp className="size-3.5" aria-hidden />
                  {t("changelog.votes", { count: entry.votes })}
                </span>
              )}
            </button>
          </Card>
        </li>
      ))}
    </ol>
  );
}
