import { cn } from "@joyorogo/ui/lib/utils";
import { Check } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

/** The page's three sections are bands: an icon, a title and what it is for, then their cards. */
export function SectionBand({
  id,
  Icon,
  title,
  subtitle,
  children,
}: {
  id: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="scroll-mt-20 lg:scroll-mt-6">
      <header className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-[1.125rem]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-xl font-extrabold tracking-tight">
            {title}
          </h2>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export function Steps({ items }: { items: readonly string[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-sm leading-relaxed">
          <span
            aria-hidden
            className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary tabular-nums"
          >
            {index + 1}
          </span>
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5 text-sm leading-relaxed">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

const TONES = {
  good: "bg-recovery/10 text-recovery",
  bad: "bg-destructive/10 text-destructive",
  warn: "bg-warning/10 text-warning",
  quiet: "bg-muted text-muted-foreground",
} as const;

/** A short status word: the text carries the meaning, the color only echoes it. */
export function Pill({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
