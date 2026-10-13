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
  Scale,
  Utensils,
  Users2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/avatar";
import { Card } from "@/components/kit/surface";
import { CommentsSheet } from "@/components/feed/comments-sheet";
import { PostMenuSheet } from "@/components/feed/post-menu";
import { Sticker, postPhotoUrl, stickerUrl } from "@/components/sticker";
import type { FeedPost } from "@/lib/api-types";
import { fmtInt, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const KIND_ICON = {
  makan: Utensils,
  latihan: Dumbbell,
  berat: Scale,
} as const;

function VisibilityTag({ visibility }: { visibility: FeedPost["visibility"] }) {
  const Publik = visibility === "publik" ? Globe : Users2;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-bold text-muted-foreground"
      aria-label={visibility === "publik" ? "Postingan publik" : "Hanya teman grup"}
    >
      <Publik className="size-3" aria-hidden />
      {visibility === "publik" ? "Publik" : "Grup"}
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
  const parts = [
    macros.protein != null ? `P ${fmtInt(macros.protein)}` : null,
    macros.carbs != null ? `K ${fmtInt(macros.carbs)}` : null,
    macros.fat != null ? `L ${fmtInt(macros.fat)}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="text-xs font-semibold text-muted-foreground">{parts.join(" · ")} g</p>;
}

function WorkoutChips({ post }: { post: FeedPost }) {
  const stats = post.stats ?? {};
  const chips: string[] = [];
  if (post.durationMin != null) chips.push(`${fmtInt(post.durationMin)} menit`);
  if (typeof stats.sets === "number") chips.push(`${fmtInt(stats.sets)} set`);
  if (typeof stats.reps === "number" && stats.reps > 0) chips.push(`${fmtInt(stats.reps)} rep`);
  if (typeof stats.volumeKg === "number" && stats.volumeKg > 0)
    chips.push(`${fmtInt(stats.volumeKg)} kg volume`);
  if (post.kcal != null) chips.push(`${fmtInt(post.kcal)} kcal`);
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
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
  const stats = post.stats ?? {};
  if (typeof stats.weightKg !== "number") return null;
  const delta = typeof stats.deltaKg === "number" ? stats.deltaKg : null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      <li className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
        {fmtInt(stats.weightKg)} kg
      </li>
      {delta !== null && delta !== 0 && (
        <li
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-bold",
            delta < 0 ? "bg-primary/10 text-primary" : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
          )}
        >
          {delta < 0 ? `Turun ${fmtInt(Math.abs(delta))} kg` : `Naik ${fmtInt(delta)} kg`}
        </li>
      )}
    </ul>
  );
}

/**
 * Kartu postingan feed: penulis + snapshot log + semangat/komentar. Semua
 * interaksi lokal (optimistic) lalu invalidasi query social.
 */
export function PostCard({ post, isOwn }: { post: FeedPost; isOwn: boolean }) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Optimistic: server masih sumber kebenaran lewat invalidasi feed.
  const [kudos, setKudos] = useState({
    active: post.kudosByMe ?? false,
    count: post.kudosCount,
  });

  const toggleKudos = useMutation(
    orpc.social.kudos.mutationOptions({
      onMutate: () => {
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
    <Card className="space-y-3 p-4">
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
              <span className="block truncate text-xs text-muted-foreground">
                @{author.handle}
              </span>
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
            aria-label="Aksi postingan"
            onClick={() => setMenuOpen(true)}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </span>
      </header>

      <div className="flex items-center gap-3">
        <PostMedia post={post} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-extrabold">{post.title}</p>
          {post.kind === "makan" && post.kcal != null && (
            <p className="flex items-center gap-1 text-sm font-bold text-makan-ink">
              <Flame className="size-3.5" aria-hidden />
              {fmtInt(post.kcal)} kcal
              <MacroChips post={post} />
            </p>
          )}
          {post.kind === "latihan" && <WorkoutChips post={post} />}
          {post.kind === "berat" && <WeightChips post={post} />}
        </div>
      </div>

      {post.caption && <p className="text-sm text-foreground/90">{post.caption}</p>}

      <footer className="flex items-center gap-1.5 border-t border-border/60 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5", kudos.active && "text-destructive")}
          disabled={toggleKudos.isPending}
          onClick={() => toggleKudos.mutate({ postId: post.id })}
          aria-pressed={kudos.active}
          aria-label={kudos.active ? "Batalkan semangat" : "Kasih semangat"}
        >
          <Heart className={cn("size-4", kudos.active && "fill-current")} aria-hidden />
          {fmtInt(kudos.count)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => setCommentsOpen(true)}
          aria-label="Lihat komentar"
        >
          <MessageCircle className="size-4" aria-hidden />
          {fmtInt(post.commentCount)}
        </Button>
      </footer>

      <PostMenuSheet
        post={post}
        isOwn={isOwn}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onDeleted={() => queryClient.invalidateQueries({ queryKey: orpc.social.key() })}
      />
      <CommentsSheet
        post={post}
        isOwn={isOwn}
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
      />
    </Card>
  );
}
