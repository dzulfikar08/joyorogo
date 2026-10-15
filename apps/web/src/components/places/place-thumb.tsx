import { Utensils } from "lucide-react";
import { useState } from "react";

import { cn } from "@joyorogo/ui/lib/utils";

import { STICKER_FILTER, stickerUrl } from "@/components/sticker";

/** Plain (non-interactive) sticker cutout, so it can sit inside a tappable card. */
export function PlaceThumb({
  scanId,
  className = "size-[4.5rem]",
}: {
  scanId: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!scanId || failed) {
    return (
      <span
        aria-hidden
        className={cn("grid shrink-0 place-items-center rounded-2xl bg-makan-soft", className)}
      >
        <Utensils className="size-1/3 text-makan-ink" />
      </span>
    );
  }
  return (
    <img
      src={stickerUrl(scanId)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("shrink-0 object-contain", className)}
      style={STICKER_FILTER}
    />
  );
}
