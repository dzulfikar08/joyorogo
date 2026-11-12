import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, Lightbulb, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import {
  type Board,
  type Idea,
  type IdeaDetail,
  boardQuery,
  commentOnIdea,
  ideaQuery,
  issuesKeys,
  vote,
} from "@/lib/issues";

import { CommentForm, StateBadge, useFmtDate } from "./shared";

/** Ideas on the board, most votes first. One vote per account; pressing again takes it back. */
export default function IdeasTab({
  openIdea,
  onNewIdea,
}: {
  openIdea: (id: string) => void;
  onNewIdea: () => void;
}) {
  const { t } = useTranslation("fitWebIssues");
  const board = useQuery(boardQuery);
  const voting = useVote();

  if (board.isPending) return <BlockSkeleton className="h-64" />;
  if (board.isError) return <QueryError error={board.error} onRetry={() => void board.refetch()} />;
  if (board.data.items.length === 0) {
    return (
      <Card>
        <EmptyState title={t("ideas.empty")}>
          <p>{t("ideas.emptyBody")}</p>
          <Button size="sm" className="mt-4" onClick={onNewIdea}>
            <Lightbulb aria-hidden />
            {t("actions.idea")}
          </Button>
        </EmptyState>
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {board.data.items.map((idea) => (
        <li key={idea.id}>
          <IdeaRow
            idea={idea}
            canVote={board.data.board.allow_voting}
            onVote={() => voting.mutate(idea.id)}
            onOpen={() => openIdea(idea.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function IdeaRow({
  idea,
  canVote,
  onVote,
  onOpen,
}: {
  idea: Idea;
  canVote: boolean;
  onVote: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation("fitWebIssues");
  return (
    <Card className="flex items-start gap-3 p-3 sm:p-4">
      <VoteButton idea={idea} disabled={!canVote} onVote={onVote} />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span className="block font-semibold leading-snug">{idea.name}</span>
        {idea.description && (
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
            {idea.description}
          </span>
        )}
        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StateBadge name={idea.state?.name} color={idea.state?.color} />
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden />
            {t("ideas.comments", { count: idea.comment_count })}
          </span>
        </span>
      </button>
    </Card>
  );
}

function VoteButton({
  idea,
  disabled,
  onVote,
}: {
  idea: Pick<Idea, "votes" | "voted" | "name">;
  disabled: boolean;
  onVote: () => void;
}) {
  const { t } = useTranslation("fitWebIssues");
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={idea.voted}
      aria-label={t(idea.voted ? "ideas.unvote" : "ideas.vote", { name: idea.name })}
      onClick={onVote}
      className={cn(
        "flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5 text-sm font-bold tabular-nums ring-1 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60",
        idea.voted
          ? "bg-primary text-primary-foreground ring-primary"
          : "bg-card text-foreground ring-border hover:bg-muted",
      )}
    >
      <ChevronUp className="size-4" aria-hidden />
      {idea.votes}
    </button>
  );
}

/** Toggles the account's vote, showing it at once and putting the server's count in when it answers. */
function useVote() {
  const queryClient = useQueryClient();
  const patch = (id: string, change: (idea: Idea) => Idea) => {
    queryClient.setQueryData<Board>(issuesKeys.board, (old) =>
      old ? { ...old, items: old.items.map((i) => (i.id === id ? change(i) : i)) } : old,
    );
    queryClient.setQueryData<IdeaDetail>(issuesKeys.idea(id), (old) =>
      old ? (change(old) as IdeaDetail) : old,
    );
  };
  return useMutation({
    mutationFn: vote,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: issuesKeys.board });
      const before = queryClient.getQueryData<Board>(issuesKeys.board);
      patch(id, (i) => ({ ...i, voted: !i.voted, votes: i.votes + (i.voted ? -1 : 1) }));
      return { before };
    },
    onError: (_error, _id, context) => {
      if (context?.before) queryClient.setQueryData(issuesKeys.board, context.before);
      void queryClient.invalidateQueries({ queryKey: issuesKeys.all });
    },
    onSuccess: (result, id) =>
      patch(id, (i) => ({ ...i, voted: result.voted, votes: result.count })),
  });
}

/** One idea: what it is, where it stands, the comments, and a box to add one. */
export function IdeaSheet({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const { t } = useTranslation("fitWebIssues");
  const idea = useQuery({ ...ideaQuery(id ?? ""), enabled: !!id });
  const voting = useVote();
  const queryClient = useQueryClient();
  const fmtDate = useFmtDate();
  const comment = useMutation({
    mutationFn: (body: string) => commentOnIdea(id!, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: issuesKeys.idea(id!) });
      void queryClient.invalidateQueries({ queryKey: issuesKeys.board });
    },
  });
  const board = queryClient.getQueryData<Board>(issuesKeys.board);

  return (
    <Sheet
      open={!!id}
      onOpenChange={(open) => !open && onClose()}
      title={idea.data?.name ?? t("ideas.title")}
    >
      {idea.isPending ? (
        <BlockSkeleton className="h-40" />
      ) : idea.isError ? (
        <QueryError error={idea.error} onRetry={() => void idea.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <VoteButton
              idea={idea.data}
              disabled={board ? !board.board.allow_voting : false}
              onVote={() => voting.mutate(idea.data.id)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StateBadge name={idea.data.state?.name} color={idea.data.state?.color} />
                <span>{fmtDate(idea.data.created_at)}</span>
              </div>
              {idea.data.description && (
                <p className="mt-2 text-sm whitespace-pre-line">{idea.data.description}</p>
              )}
            </div>
          </div>

          <section aria-labelledby="idea-comments" className="flex flex-col gap-2">
            <h3 id="idea-comments" className="text-sm font-bold">
              {t("ideas.comments", { count: idea.data.comments.length })}
            </h3>
            {idea.data.comments.length > 0 && (
              <ul className="flex flex-col gap-2">
                {idea.data.comments.map((c) => (
                  <li key={c.id} className="rounded-xl bg-muted px-3 py-2 text-sm">
                    <p className="whitespace-pre-line">{c.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(c.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
            {(!board || board.board.allow_comments) && (
              <>
                <CommentForm
                  label={t("ideas.commentLabel")}
                  placeholder={t("ideas.commentPlaceholder")}
                  pending={comment.isPending}
                  onSend={(body) => comment.mutateAsync(body)}
                />
                <p className="text-xs text-muted-foreground">{t("ideas.commentPublic")}</p>
              </>
            )}
            {comment.isError && (
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
