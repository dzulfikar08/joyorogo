import { cn } from "@joyorogo/ui/lib/utils";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import type { Metric } from "./ring";

/** White, borderless surface on the paper canvas. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-3xl bg-card p-5", className)} {...props} />;
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3 px-1", className)}>
      <h2 className="text-base font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

/** Page title block: 28px bold title, optional subtitle line and right-side action. */
export function PageHeader({
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
    <header className={cn("flex items-end justify-between gap-4 px-1 pt-2 pb-5", className)}>
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** Page container: phone-width column on the paper canvas. */
export function Page({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8 md:pt-6",
        className,
      )}
      {...props}
    />
  );
}

/** Grouped rows inside one card, iOS-settings style. */
export function ListGroup({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "overflow-hidden rounded-3xl bg-card [&>li+li]:before:absolute [&>li+li]:before:inset-x-5 [&>li+li]:before:top-0 [&>li+li]:before:h-px [&>li+li]:before:bg-border",
        className,
      )}
      {...props}
    />
  );
}

type RowContent = {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
};

function RowInner({ icon, title, subtitle, value, chevron }: RowContent & { chevron?: boolean }) {
  return (
    <>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-semibold">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[0.8125rem] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {value !== undefined && (
        <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums">{value}</span>
      )}
      {chevron && <ChevronRight className="size-5 shrink-0 text-muted-foreground/70" aria-hidden />}
    </>
  );
}

const ROW = "flex min-h-[3.5rem] w-full items-center gap-3 px-5 py-3 text-left";

/** A static row; pass `trailing` for an inline control (switch, delete button). */
export function ListRow({
  trailing,
  className,
  ...content
}: RowContent & { trailing?: ReactNode; className?: string }) {
  return (
    <li className={cn("relative", className)}>
      <div className={ROW}>
        <RowInner {...content} />
        {trailing}
      </div>
    </li>
  );
}

/** A row that navigates. */
export function ListLinkRow({
  to,
  params,
  search,
  ...content
}: RowContent & Pick<LinkProps, "to" | "params" | "search">) {
  return (
    <li className="relative">
      <Link
        to={to}
        params={params}
        search={search}
        className={cn(
          ROW,
          "transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        )}
      >
        <RowInner {...content} chevron />
      </Link>
    </li>
  );
}

/** A row that runs an action (opens a sheet, toggles something). */
export function ListButtonRow({
  onClick,
  destructive,
  ...content
}: RowContent & { onClick: () => void; destructive?: boolean }) {
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          ROW,
          "transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          destructive && "text-destructive",
        )}
      >
        <RowInner {...content} chevron={!destructive} />
      </button>
    </li>
  );
}

/** Pill segmented control (radio group semantics). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  /** Accessible group name. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative flex gap-1 overflow-x-auto rounded-full bg-muted p-1 no-scrollbar",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            // Long option lists scroll horizontally; center the chosen one
            // without ever scrolling the page itself.
            ref={
              active
                ? (node) => {
                    const rail = node?.parentElement;
                    if (!node || !rail || rail.scrollWidth <= rail.clientWidth) return;
                    rail.scrollLeft = node.offsetLeft - (rail.clientWidth - node.offsetWidth) / 2;
                  }
                : undefined
            }
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-10 flex-1 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              active
                ? "bg-card text-foreground shadow-[0_1px_3px_oklch(0.3_0.02_85/12%)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const TINT: Record<Metric, { tile: string; chip: string; ink: string }> = {
  makan: { tile: "bg-makan-soft", chip: "bg-card text-makan", ink: "text-makan-ink" },
  bakar: { tile: "bg-bakar-soft", chip: "bg-card text-bakar", ink: "text-bakar-ink" },
  tidur: { tile: "bg-tidur-soft", chip: "bg-card text-tidur", ink: "text-tidur-ink" },
};

/** Soft-tinted metric tile. Becomes a link when `to` is given. */
export function StatTile({
  metric,
  icon,
  label,
  value,
  unit,
  sub,
  to,
  className,
}: {
  metric: Metric;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  to?: LinkProps["to"];
  className?: string;
}) {
  const tint = TINT[metric];
  const body = (
    <>
      <span className={cn("flex size-9 items-center justify-center rounded-full", tint.chip)}>
        {icon}
      </span>
      <span className={cn("mt-3 block text-[0.8125rem] font-semibold", tint.ink)}>{label}</span>
      <span className="mt-0.5 block text-2xl leading-tight font-extrabold tracking-tight tabular-nums">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-muted-foreground">{unit}</span>}
      </span>
      {sub && <span className="mt-1 block text-xs text-muted-foreground tabular-nums">{sub}</span>}
    </>
  );
  const base = cn("block rounded-2xl p-4", tint.tile, className);
  return to ? (
    <Link
      to={to}
      className={cn(
        base,
        "pressable focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

/** Small uppercase-free field label used above inputs. */
export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "mb-1.5 block px-1 text-[0.8125rem] font-semibold text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
