import { cn } from "@joyorogo/ui/lib/utils";

/** JoyoFit ring mark: a step ring open from 12 o'clock with a trailing marker (site/public/favicon.svg of the JoyoFit repo). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={cn("size-8 shrink-0", className)} aria-hidden>
      <path
        d="M512 250A262 262 0 1 1 285.1 643"
        fill="none"
        strokeWidth="120"
        strokeLinecap="round"
        className="stroke-primary"
      />
      <circle cx="255.73" cy="457.53" r="74" className="fill-[#2BA3C4] dark:fill-[#BFE7F3]" />
    </svg>
  );
}
