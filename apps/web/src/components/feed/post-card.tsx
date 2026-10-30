import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Dumbbell,
  Ellipsis,
  Flame,
  Globe,
  Heart,
  MessageCircle,
  MessageCircleOff,
  PenLine,
  Scale,
  Utensils,
  Users2,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatDuration, formatPace } from "@joyorogo/api/lib/workout-analysis";
import { paceOrSpeed, sportKindFromName } from "@joyorogo/api/lib/feed-route";

import { undoLabel, UNDO_TOAST_MS } from "@/lib/optimistic";

import { Avatar } from "@/components/avatar";
import { Card } from "@/components/kit/surface";
import { CommentsSheet } from "@/components/feed/comments-sheet";
import { PhotoGrid } from "@/components/feed/photo-grid";
import { PostMenuSheet } from "@/components/feed/post-menu";
import { RouteMapPreview } from "@/components/feed/route-map-preview";
import { MacroLine } from "@/components/macro-line";
import { Sticker, postPhotoUrl, stickerUrl } from "@/components/sticker";
import type { FeedPost } from "@/lib/api-types";
import { fmtInt, fmtKcalLabel, fmtKg, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const STORY_PREVIEW = 280;

/** Teks pos cerita; lebih dari ~280 karakter dipangkas dengan Selengkapnya. */
function StoryText({ caption }: { caption: string }) {
  const { t } = useTranslation("feed");
  const [expanded, setExpanded] = useState(false);
  if (caption.length <= STORY_PREVIEW) {
    return <p className="text-sm whitespace-pre-wrap text-foreground/90">{caption}</p>;
  }
  return (
    <p className="text-sm whitespace-pre-wrap text-foreground/90">
      {expanded ? caption : `${caption.slice(0, STORY_PREVIEW)}...`}
      <button
        type="button"
        className="ml-1.5 text-sm font-bold text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? t("post.showLess") : t("post.showMore")}
      </button>
    </p>
  );
}

const KIND_ICON = {
  makan: Utensils,
  latihan: Dumbbell,
  berat: Scale,
  cerita: PenLine,
} as const;

function VisibilityTag({ visibility }: { visibility: FeedPost["visibility"] }) {
  const { t } = useTranslation("feed");
  const Publik = visibility === "publik" ? Globe : Users2;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-bold text-muted-foreground"
      aria-label={t(`visibility.label.${visibility}`)}
    >
      <Publik className="size-3" aria-hidden />
      {t(`visibility.${visibility}`)}
    </span>
  );
}

/** Foto/stiker milik postingan — bukan file pribadi pemilik log. */
function PostMedia({ post, className }: { post: FeedPost; className?: string }) {
  if (post.photoId) {
    return (
      <img
        src={postPhotoUrl(post.id)}
        alt={post.title}
        loading="lazy"
        className={cn("size-20 shrink-0 rounded-2xl bg-muted object-cover", className)}
      />
    );
  }
  if (post.scanId) {
    return (
      <Sticker
        scanId={post.scanId}
        name={post.title}
        className={cn("block size-20 shrink-0", className)}
        fallback={
          <span className="grid size-20 shrink-0 place-items-center rounded-2xl bg-makan-soft">
            <Utensils className="size-8 text-makan-ink" aria-hidden />
          </span>
        }
      />
    );
  }
  const Icon = KIND_ICON[post.kind];
  const soft =
    post.kind === "makan" ? "bg-makan-soft text-makan-ink" : "bg-bakar-soft text-bakar-ink";
  return (
    <span className={cn("grid size-20 shrink-0 place-items-center rounded-2xl", soft, className)}>
      <Icon className="size-8" aria-hidden />
    </span>
  );
}

function MacroChips({ post }: { post: FeedPost }) {
  const macros = post.macros;
  if (!macros) return null;
  return (
    <MacroLine
      compact
      protein={macros.protein}
      carbs={macros.carbs}
      fat={macros.fat}
      className="text-xs font-semibold text-muted-foreground"
    />
  );
}

function WorkoutChips({ post }: { post: FeedPost }) {
  const { t } = useTranslation("feed");
  const stats = post.stats ?? {};
  const fromWatch = stats.source === "joyofit";
  const chips: string[] = [];
  if (fromWatch) {
    const distanceM = typeof stats.distanceM === "number" && stats.distanceM > 0 ? stats.distanceM : null;
    const movingSec = typeof stats.movingSec === "number" && stats.movingSec > 0 ? stats.movingSec : null;
    if (distanceM !== null) {
      const km = distanceM / 1000;
      chips.push(t("watch.chip.distance", { km: km.toFixed(km < 10 ? 2 : 1) }));
    }
    if (movingSec !== null) chips.push(formatDuration(movingSec));
    else if (post.durationMin != null) chips.push(t("post.chip.minutes", { n: fmtInt(post.durationMin) }));
    const sportKind = typeof stats.sportKind === "string" ? stats.sportKind : sportKindFromName(post.title);
    const pace = paceOrSpeed(
      sportKind,
      distanceM,
      movingSec ?? (post.durationMin != null ? post.durationMin * 60 : null),
    );
    if (pace?.kind === "pace") chips.push(t("watch.chip.pace", { pace: formatPace(pace.secPerKm) }));
    else if (pace?.kind === "speed") chips.push(t("watch.chip.speed", { kmh: pace.kmh.toFixed(1) }));
    if (typeof stats.elevGainM === "number" && stats.elevGainM > 0)
      chips.push(t("watch.chip.elev", { m: fmtInt(Math.round(stats.elevGainM)) }));
  } else {
    if (post.durationMin != null) chips.push(t("post.chip.minutes", { n: fmtInt(post.durationMin) }));
    if (typeof stats.sets === "number")
      chips.push(t("post.chip.sets", { count: stats.sets }));
    if (typeof stats.reps === "number" && stats.reps > 0)
      chips.push(t("post.chip.reps", { count: stats.reps }));
    if (typeof stats.volumeKg === "number" && stats.volumeKg > 0)
      chips.push(t("post.chip.volume", { kg: fmtInt(stats.volumeKg) }));
  }
  if (post.kcal != null) chips.push(fmtKcalLabel(post.kcal));
  if (fromWatch && typeof stats.avgHr === "number")
    chips.push(t("watch.chip.avgHr", { bpm: fmtInt(stats.avgHr) }));
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {fromWatch && (
        <li className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
          {t("watch.badge")}
        </li>
      )}
      {chips.map((chip) => (
        <li
          key={chip}
          className="rounded-full bg-bakar-soft px-2.5 py-1 text-xs font-bold text-bakar-ink"
        >
          {chip}
        </li>
      ))}
    </ul>
  );
}

function WeightChips({ post }: { post: FeedPost }) {
  const { t } = useTranslation("feed");
  const stats = post.stats ?? {};
  if (typeof stats.weightKg !== "number") return null;
  const delta = typeof stats.deltaKg === "number" ? stats.deltaKg : null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      <li className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
        {fmtKg(stats.weightKg)} kg
      </li>
      {delta !== null && delta !== 0 && (
        <li
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-bold",
            delta < 0
              ? "bg-primary/10 text-primary"
              : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
          )}
        >
          {delta < 0
            ? t("post.chip.down", { kg: fmtKg(Math.abs(delta)) })
            : t("post.chip.up", { kg: fmtKg(delta) })}
        </li>
      )}
    </ul>
  );
}

/**
 * Kartu postingan feed: penulis + snapshot log + semangat/komentar. Semua
 * interaksi lokal (optimistic) lalu invalidasi query social.
 */
export function PostCard({
  post,
  isOwn,
  index = 0,
  hideMap = false,
}: {
  post: FeedPost;
  isOwn: boolean;
  index?: number;
  /** The post page draws the larger map itself. */
  hideMap?: boolean;
}) {
  const { t } = useTranslation("feed");
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Optimistic: server masih sumber kebenaran lewat invalidasi feed.
  const [kudos, setKudos] = useState({
    active: post.kudosByMe ?? false,
    count: post.kudosCount,
  });
  // Counts kudos given this visit; the key restarts the pulse and keeps first paint still.
  const [kudosPop, setKudosPop] = useState(0);

  const toggleKudos = useMutation(
    orpc.social.kudos.mutationOptions({
      onMutate: (input) => {
        const turningOn = !kudos.active;
        if (turningOn) {
          toast.success(t("post.kudos.sent"), {
            duration: UNDO_TOAST_MS,
            action: { label: undoLabel(), onClick: () => toggleKudos.mutate(input) },
          });
        }
        setKudos((prev) => ({
          active: !prev.active,
          count: prev.count + (prev.active ? -1 : 1),
        }));
      },
      onError: (error) => {
        // Kembalikan angka dari server; snapshot lokal bisa basi.
        queryClient.invalidateQueries({ queryKey: orpc.social.key() });
        toast.error(error.message);
      },
    }),
  );

  const author = post.author;

  return (
    <Card
      className="post-enter space-y-3 p-4"
      style={{ "--post-index": index } as CSSProperties}
    >
      <header className="flex items-center gap-3">
        {author.handle ? (
          <Link
            to="/u/$handle"
            params={{ handle: author.handle }}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Avatar name={author.name} image={author.image} className="size-10" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{author.name}</span>
              <span className="block truncate text-xs text-muted-foreground">@{author.handle}</span>
            </span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar name={author.name} image={author.image} className="size-10" />
            <span className="min-w-0 truncate text-sm font-bold">{author.name}</span>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          <VisibilityTag visibility={post.visibility} />
          <span className="text-xs text-muted-foreground">{timeAgo(post.createdAt)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("post.actions")}
            onClick={() => setMenuOpen(true)}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </span>
      </header>

      {post.kind === "cerita" ? (
        <>
          {post.caption && <StoryText caption={post.caption} />}
          {post.photoCount > 0 && <PhotoGrid postId={post.id} count={post.photoCount} />}
        </>
      ) : (
        <div className="flex items-center gap-3">
          <PostMedia post={post} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-extrabold">
              {post.kind === "berat" ? t("post.weightTitle") : post.title}
            </p>
            {post.kind === "makan" && post.kcal != null && (
              <p className="flex items-center gap-1 text-sm font-bold text-makan-ink">
                <Flame className="size-3.5" aria-hidden />
                {fmtKcalLabel(post.kcal)}
                <MacroChips post={post} />
              </p>
            )}
            {post.kind === "latihan" && <WorkoutChips post={post} />}
            {post.kind === "berat" && <WeightChips post={post} />}
          </div>
        </div>
      )}

      {post.kind === "latihan" && post.mapLine && !hideMap && (
        <RouteMapPreview line={post.mapLine} title={post.title} size="card" />
      )}

      {post.kind !== "cerita" && post.caption && (
        <p className="text-sm text-foreground/90">{post.caption}</p>
      )}

      <footer className="flex items-center gap-1.5 border-t border-border/60 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5", kudos.active && "text-destructive")}
          disabled={toggleKudos.isPending}
          onClick={() => {
            if (!kudos.active) setKudosPop((n) => n + 1);
            toggleKudos.mutate({ postId: post.id });
          }}
          aria-pressed={kudos.active}
          aria-label={kudos.active ? t("post.kudos.remove") : t("post.kudos.give")}
        >
          <Heart
            key={kudosPop}
            className={cn(
              "size-4",
              kudos.active && "fill-current",
              kudosPop > 0 && kudos.active && "heart-pop",
            )}
            aria-hidden
          />
          {fmtInt(kudos.count)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5 text-muted-foreground", post.commentsOff && "opacity-70")}
          onClick={() => setCommentsOpen(true)}
          aria-label={post.commentsOff ? t("comments.off.label") : t("post.comments.view")}
        >
          {post.commentsOff ? (
            <MessageCircleOff className="size-4" aria-hidden />
          ) : (
            <MessageCircle className="size-4" aria-hidden />
          )}
          {post.commentsOff ? t("comments.off.button") : null}
          {post.commentsOff && post.commentCount === 0 ? null : fmtInt(post.commentCount)}
        </Button>
      </footer>

      <PostMenuSheet
        post={post}
        isOwn={isOwn}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onDeleted={() => queryClient.invalidateQueries({ queryKey: orpc.social.key() })}
      />
      <CommentsSheet post={post} isOwn={isOwn} open={commentsOpen} onOpenChange={setCommentsOpen} />
    </Card>
  );
}
