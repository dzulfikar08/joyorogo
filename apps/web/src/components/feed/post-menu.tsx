import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, ShieldOff, Trash2, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { ListButtonRow, ListGroup } from "@/components/kit/surface";
import type { FeedPost } from "@/lib/api-types";
import { useDelayedDelete } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

const REASONS = ["spam", "kasar", "salah_info", "lainnya"] as const;

type Reason = (typeof REASONS)[number];

/**
 * Menu "..." pada kartu postingan: lapor, blokir penulis, atau hapus
 * (postingan sendiri). Semua aksi memakai sheet, bukan dialog OS.
 */
export function PostMenuSheet({
  post,
  isOwn,
  open,
  onOpenChange,
  onDeleted,
}: {
  post: FeedPost | null;
  isOwn: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation(["feed", "common"]);
  const queryClient = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("spam");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) {
      setReportOpen(false);
      setNote("");
      setReason("spam");
    }
  }, [open]);

  const report = useMutation(
    orpc.social.report.mutationOptions({
      onSuccess: () => {
        toast.success(t("menu.toast.reported"));
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const block = useMutation(
    orpc.social.block.mutationOptions({
      onSuccess: () => {
        toast.success(t("menu.toast.blocked"));
        queryClient.invalidateQueries({ queryKey: orpc.social.key() });
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  // Delayed-commit delete: post vanishes from every feed cache instantly,
  // DELETE fires after the undo window; undo restores with zero server calls.
  const removePost = useDelayedDelete<FeedPost>({
    remove: (row) => client.social.deletePost({ id: row.id }),
    patch: (row, cache) => {
      cache.matching<{ pages: Array<{ items: FeedPost[] }>; pageParams: unknown[] }>(
        orpc.social.feed.key(),
        (data) => ({
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== row.id),
          })),
        }),
      );
      cache.matching<{ pages: Array<{ items: FeedPost[] }>; pageParams: unknown[] }>(
        orpc.social.myPosts.key(),
        (data) => ({
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== row.id),
          })),
        }),
      );
    },
    label: () => t("menu.undoLabel"),
    invalidate: () => [orpc.social.key()],
  });

  if (!post) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("post.actions")}>
      {reportOpen ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("report.ask")}
            </p>
            <ListGroup>
              {REASONS.map((option) => (
                <ListButtonRow
                  key={option}
                  onClick={() => setReason(option)}
                  title={t(`report.reason.${option}`)}
                  icon={
                    <span
                      className={
                        reason === option
                          ? "grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background"
                          : "grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                      }
                    >
                      <Flag className="size-4" aria-hidden />
                    </span>
                  }
                />
              ))}
            </ListGroup>
            <label className="block space-y-1.5">
              <p className="text-sm font-bold">{t("report.note")}</p>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                rows={2}
                placeholder={t("report.notePlaceholder")}
              />
            </label>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setReportOpen(false)}
              >
                {t("common:actions.back")}
              </Button>
              <Button
                className="flex-1"
                disabled={report.isPending}
                onClick={() =>
                  report.mutate({
                    postId: post.id,
                    reason,
                    note: note.trim() || undefined,
                  })
                }
              >
                {report.isPending ? t("report.sending") : t("report.send")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ListGroup>
              {!isOwn && (
                <ListButtonRow
                  onClick={() => setReportOpen(true)}
                  icon={
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted">
                      <Flag className="size-5 text-muted-foreground" aria-hidden />
                    </span>
                  }
                  title={t("menu.report.title")}
                  subtitle={t("menu.report.subtitle")}
                />
              )}
              {!isOwn && (
                <ListButtonRow
                  destructive
                  onClick={() => block.mutate({ userId: post.author.id })}
                  icon={
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted">
                      <UserX className="size-5 text-destructive" aria-hidden />
                    </span>
                  }
                  title={t("menu.block.title", { name: post.author.name })}
                  subtitle={t("menu.block.subtitle")}
                />
              )}
              {isOwn && (
                <ListButtonRow
                  destructive
                  onClick={() => {
                    onOpenChange(false);
                    onDeleted?.();
                    removePost(post);
                  }}
                  icon={
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted">
                      <Trash2 className="size-5 text-destructive" aria-hidden />
                    </span>
                  }
                  title={t("menu.delete.title")}
                  subtitle={t("menu.delete.subtitle")}
                />
              )}
            </ListGroup>
            {!isOwn && (
              <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                <ShieldOff className="size-3.5" aria-hidden />
                {t("menu.block.note")}
              </p>
            )}
          </div>
        )}
      </Sheet>
  );
}
