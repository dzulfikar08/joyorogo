import { cn } from "@joyorogo/ui/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Borderless white surface on the paper canvas, with a hairline ring so it still reads in dark mode. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-surface="card"
      className={cn("min-w-0 rounded-2xl bg-card p-4 ring-1 ring-foreground/5 sm:p-5", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}
    >
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight sm:text-[1.75rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Plain-text name for screen readers when `label` is an icon. */
  name?: string;
}

/** A row of mutually exclusive choices. Pills share one track; the selected one is raised. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex max-w-full rounded-full bg-muted p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.name}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            option.value === value
              ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type Better = "up" | "down" | "none";

/**
 * How a metric moved against the period before. Green when it moved the good way, red the bad way, grey for a metric
 * with no good direction (training volume) or no movement. The arrow carries direction without color.
 */
export function Delta({
  text,
  direction,
  better,
}: {
  text: string;
  direction: "up" | "down" | "flat";
  better: Better;
}) {
  const { t } = useTranslation("fitWeb");
  const good = direction !== "flat" && better !== "none" && direction === better;
  const bad = direction !== "flat" && better !== "none" && direction !== better;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
        good ? "text-recovery" : bad ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {text}
      <span className="sr-only"> {t("compare.vsPrevious")}</span>
    </span>
  );
}

/** The width of a figure in digit widths (the value, plus the unit at about half size): Titik fits Doto's wide digits to the tile with it. */
function figureUnits(value: ReactNode, unit: string | undefined): number {
  const digits = typeof value === "string" || typeof value === "number" ? String(value).length : 6;
  return Math.max(1, digits + (unit ? unit.length * 0.5 + 0.4 : 0));
}

/** One headline number with its label, an optional change and an optional spark line underneath. */
export function Stat({
  label,
  value,
  unit,
  hint,
  delta,
  icon,
  tone = "text-foreground",
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  delta?: ReactNode;
  icon?: ReactNode;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-surface="tile"
      className="flex min-w-0 flex-col rounded-2xl bg-card p-3.5 ring-1 ring-foreground/5 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-semibold text-muted-foreground">{label}</p>
        {icon}
      </div>
      <div data-figure-box>
        <p
          data-figure
          style={{ "--figure-units": figureUnits(value, unit) } as CSSProperties}
          className={cn(
            "mt-1.5 flex flex-wrap items-baseline gap-x-1 text-[1.625rem] leading-none font-extrabold tracking-tight tabular-nums",
            tone,
          )}
        >
          {value}
          {unit && <span className="text-sm font-semibold text-muted-foreground">{unit}</span>}
        </p>
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {delta}
        {hint}
      </div>
      {children}
    </div>
  );
}

/** Round tile with the icon of a data color. */
export function IconChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", className)}>
      {children}
    </span>
  );
}
