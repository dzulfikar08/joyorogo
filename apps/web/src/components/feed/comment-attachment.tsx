import { cn } from "@joyorogo/ui/lib/utils";
import { CalendarDays, Dumbbell, ImageOff, Route, Scale, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { attachmentFacts } from "@joyorogo/api/lib/comment-attachment-view";
import type { AttachmentFact } from "@joyorogo/api/lib/comment-attachment-view";
import { weekRangeLabel } from "@joyorogo/api/lib/recap";
import { getActiveLocale } from "@joyorogo/i18n";
import type { TFunction } from "@joyorogo/i18n";

import { RouteMapPreview } from "@/components/feed/route-map-preview";
import type { CommentAttachment } from "@/lib/api-types";

const KIND_ICON: Record<Exclude<CommentAttachment["kind"], "image">, LucideIcon> = {
  workout: Dumbbell,
  food: Utensils,
  weight: Scale,
  recap: CalendarDays,
  route: Route,
};

/** One fact line ("32 mnt"); the key is built from the fact's kind, so the typed `t` cannot check it. */
function factText(t: TFunction<"feed">, fact: AttachmentFact): string {
  const translate = t as unknown as (key: string, options: Record<string, string | number>) => string;
  return translate(`comments.fact.${fact.key}`, fact.params);
}

/** Heading of an item card: its own name, or the kind's label for items that have none (weight, recap). */
export function attachmentTitle(t: TFunction<"feed">, attachment: CommentAttachment): string {
  if (attachment.kind === "weight") return t("comments.attach.title.weight");
  if (attachment.kind === "recap") {
    const weekStart = attachment.stats.weekStart;
    return t("comments.attach.title.recap", {
      range: typeof weekStart === "string" ? weekRangeLabel(weekStart) : "",
    });
  }
  return attachment.title || t(`comments.attach.kind.${attachment.kind === "image" ? "workout" : attachment.kind}`);
}

/**
 * What a comment carries besides its text. `photoSrc` is where the photo (an uploaded image, or a meal's photo) loads
 * from; a comment passes its /comment-photo URL, the picker the owner's own diary photo.
 */
export function CommentAttachmentCard({
  attachment,
  photoSrc,
  className,
}: {
  attachment: CommentAttachment;
  photoSrc?: string | undefined;
  className?: string;
}) {
  const { t } = useTranslation("feed");
  const [failed, setFailed] = useState(false);

  if (attachment.kind === "image") {
    return failed || !photoSrc ? (
      <div
        className={cn("flex h-24 w-40 items-center justify-center rounded-2xl bg-muted text-muted-foreground", className)}
        role="img"
        aria-label={t("comments.attach.photoAlt")}
      >
        <ImageOff className="size-5" aria-hidden />
      </div>
    ) : (
      <img
        src={photoSrc}
        alt={t("comments.attach.photoAlt")}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn("max-h-64 w-auto max-w-full rounded-2xl border border-border bg-muted object-cover", className)}
      />
    );
  }

  const Icon = KIND_ICON[attachment.kind];
  const title = attachmentTitle(t, attachment);
  const facts = attachmentFacts(attachment.kind, attachment.stats, getActiveLocale());
  const showPhoto = attachment.hasPhoto && photoSrc && !failed;

  return (
    <figure
      aria-label={t("comments.attach.cardLabel", { title })}
      className={cn("m-0 w-full max-w-sm min-w-0 overflow-hidden rounded-2xl border border-border bg-muted/50", className)}
    >
      {attachment.kind === "route" && attachment.mapLine && (
        <RouteMapPreview line={attachment.mapLine} title={title} size="card" className="[&>div]:rounded-none" />
      )}
      <div className="flex min-w-0 items-start gap-3 p-3">
        {showPhoto ? (
          <img
            src={photoSrc}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="size-14 shrink-0 rounded-xl bg-muted object-cover"
          />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[0.6875rem] font-bold tracking-wide text-muted-foreground uppercase">
            {t(`comments.attach.kind.${attachment.kind}`)}
          </p>
          <p className="text-sm font-bold [overflow-wrap:anywhere]">{title}</p>
          {facts.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {facts.map((fact) => (
                <li key={fact.key}>{factText(t, fact)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </figure>
  );
}
