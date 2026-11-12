import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/kit";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import { type MineItem, issuesKeys, replyToTicket, reportsQuery, ticketQuery } from "@/lib/issues";

import { CommentForm, StateBadge, useFmtDate } from "./shared";

/**
 * What this account filed: tickets (bug reports and help requests, with the team's replies) and its ideas. Reports
 * typed in with this email elsewhere without the account's signature are listed apart, read-only.
 */
export default function ReportsTab({
  openTicket,
  openIdea,
  onNewReport,
}: {
  openTicket: (seq: number, project: string) => void;
  openIdea: (id: string) => void;
  onNewReport: () => void;
}) {
  const { t } = useTranslation("fitWebIssues");
  const fmtDate = useFmtDate();
  const reports = useQuery(reportsQuery);

  if (reports.isPending) return <BlockSkeleton className="h-64" />;
  if (reports.isError)
    return <QueryError error={reports.error} onRetry={() => void reports.refetch()} />;
  const { tickets, ideas, unverified } = reports.data;
  if (tickets.length === 0 && ideas.length === 0 && unverified.length === 0) {
    return (
      <Card>
        <EmptyState title={t("reports.empty")}>
          <p>{t("reports.emptyBody")}</p>
          <Button size="sm" className="mt-4" onClick={onNewReport}>
            <Bug aria-hidden />
            {t("actions.report")}
          </Button>
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tickets.length > 0 && (
        <Card>
          <CardHeader title={t("reports.tickets")} subtitle={t("reports.ticketsHint")} />
          <ul className="-mx-2 flex flex-col">
            {tickets.map((ticket) => (
              <Row
                key={`${ticket.project_id}:${ticket.sequence_id}`}
                title={ticket.name}
                meta={
                  <>
                    <StateBadge name={ticket.state?.name} color={ticket.state?.color} />
                    <span>{fmtDate(ticket.updated_at ?? ticket.created_at)}</span>
                  </>
                }
                onOpen={() => openTicket(ticket.sequence_id, ticket.project_id)}
              />
            ))}
          </ul>
        </Card>
      )}
      {ideas.length > 0 && (
        <Card>
          <CardHeader title={t("reports.ideas")} />
          <ul className="-mx-2 flex flex-col">
            {ideas.map((idea) => (
              <MineRow key={idea.id} item={idea} onOpen={() => openIdea(idea.id)} />
            ))}
          </ul>
        </Card>
      )}
      {unverified.length > 0 && (
        <Card>
          <CardHeader title={t("reports.unverified")} subtitle={t("reports.unverifiedHint")} />
          <ul className="-mx-2 flex flex-col">
            {unverified.map((item) => (
              <MineRow
                key={item.id}
                item={item}
                onOpen={item.kind === "idea" ? () => openIdea(item.id) : undefined}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MineRow({ item, onOpen }: { item: MineItem; onOpen?: () => void }) {
  const fmtDate = useFmtDate();
  return (
    <Row
      title={item.name}
      meta={
        <>
          <StateBadge name={item.state_name} color={item.state_color} />
          <span>{fmtDate(item.created_at)}</span>
        </>
      }
      onOpen={onOpen}
    />
  );
}

function Row({ title, meta, onOpen }: { title: string; meta: ReactNode; onOpen?: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
      {onOpen && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-2 py-2.5">{body}</div>
      )}
    </li>
  );
}

/** One ticket: the report, the conversation with the team, and a reply box. */
export function TicketSheet({
  seq,
  project,
  onClose,
}: {
  seq: number | undefined;
  project: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation("fitWebIssues");
  const fmtDate = useFmtDate();
  const queryClient = useQueryClient();
  const ticket = useQuery({ ...ticketQuery(seq ?? 0, project), enabled: seq !== undefined });
  const reply = useMutation({
    mutationFn: (body: string) => replyToTicket(seq!, body, project),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: issuesKeys.ticket(seq!, project) });
      void queryClient.invalidateQueries({ queryKey: issuesKeys.reports });
    },
  });

  return (
    <Sheet
      open={seq !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title={ticket.data?.name ?? t("reports.ticket")}
    >
      {ticket.isPending ? (
        <BlockSkeleton className="h-40" />
      ) : ticket.isError ? (
        <QueryError error={ticket.error} onRetry={() => void ticket.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StateBadge name={ticket.data.state?.name} color={ticket.data.state?.color} />
            <span>{fmtDate(ticket.data.created_at)}</span>
          </div>
          {ticket.data.description && (
            <p className="rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-line">
              {ticket.data.description}
            </p>
          )}
          <section aria-labelledby="ticket-thread" className="flex flex-col gap-2">
            <h3 id="ticket-thread" className="text-sm font-bold">
              {t("reports.thread")}
            </h3>
            {ticket.data.comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reports.noReplies")}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {ticket.data.comments.map((c) => (
                  <li
                    key={c.id}
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                      c.from === "you"
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-muted",
                    )}
                  >
                    <p className="text-xs font-semibold opacity-80">
                      {c.from === "you" ? t("reports.you") : (c.author_name ?? t("reports.team"))}
                    </p>
                    <p className="whitespace-pre-line">{c.text}</p>
                    <p className="mt-1 text-xs opacity-70">{fmtDate(c.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
            <CommentForm
              label={t("reports.replyLabel")}
              placeholder={t("reports.replyPlaceholder")}
              pending={reply.isPending}
              onSend={(body) => reply.mutateAsync(body)}
            />
            {reply.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t("error.send")}
              </p>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
