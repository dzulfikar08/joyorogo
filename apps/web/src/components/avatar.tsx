import { cn } from "@joyorogo/ui/lib/utils";

import { env } from "@/env.public";
import { getServerUrl } from "@/utils/orpc";

/** User avatar: Google photo when present, else the initial on a muted disc. */
export function Avatar({
  name,
  image,
  className,
}: {
  name: string;
  image: string | null;
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  if (image) {
    return (
      <img
        src={image.startsWith("/") ? `${getServerUrl(env.VITE_SERVER_URL)}${image}` : image}
        alt=""
        className={cn("size-11 shrink-0 rounded-full bg-muted object-cover", className)}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-extrabold text-muted-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
