import { Select as SelectPrimitive } from "@base-ui/react/select";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** Custom dropdown on the shared headless lib: filled trigger + styled popup. */
export function Select({
  value,
  onValueChange,
  options,
  className,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
} & Omit<ComponentProps<"button">, "value" | "onChange" | "children">) {
  return (
    <SelectPrimitive.Root
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectPrimitive.Trigger
        data-slot="select"
        className={cn(
          "flex h-12 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-xl border border-transparent bg-muted px-3 pr-9 text-base text-foreground transition-[border-color,box-shadow,background-color] outline-none focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:border-ring/60 data-popup-open:bg-card data-popup-open:ring-[3px] data-popup-open:ring-ring/25",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="pointer-events-none size-4 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} className="z-50 outline-none">
          <SelectPrimitive.Popup className="max-h-[min(20rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-xl border border-border bg-card p-1 text-popover-foreground shadow-lg">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-muted"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check className="size-4 text-primary" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Confirm dialog for destructive actions: trigger button + Batal/Ya popup. */
export function ConfirmAction({
  trigger,
  triggerVariant = "outline",
  triggerSize = "sm",
  title,
  description,
  destructive = false,
  confirmLabel = "Ya",
  disabled,
  onConfirm,
}: {
  trigger: ReactNode;
  triggerVariant?: ComponentProps<typeof Button>["variant"];
  triggerSize?: ComponentProps<typeof Button>["size"];
  title: string;
  description: ReactNode;
  destructive?: boolean;
  confirmLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root>
      <AlertDialogPrimitive.Trigger
        render={
          <Button size={triggerSize} variant={triggerVariant} disabled={disabled}>
            {trigger}
          </Button>
        }
      />
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100dvw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 text-foreground shadow-lg outline-none">
          <AlertDialogPrimitive.Title className="text-base font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Close
              render={<Button size="sm" variant="ghost">Batal</Button>}
            />
            <AlertDialogPrimitive.Close
              render={
                <Button
                  size="sm"
                  variant={destructive ? "destructive" : "default"}
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </Button>
              }
            />
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/** Vertical bar chart, pure CSS. Continuous x-axis; tooltips via title. */
export function BarChart({
  rows,
  height = 130,
  formatValue = (v: number) => String(v),
}: {
  rows: { key: string; label: string; value: number }[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[3rem_1fr] gap-2">
        <div
          className="flex flex-col items-end justify-between text-right text-[0.625rem] leading-none tabular-nums text-muted-foreground"
          style={{ height }}
        >
          <span>{formatValue(max)}</span>
          <span>{formatValue(Math.round(max / 2))}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0" style={{ height }}>
          <div className="absolute inset-0 flex flex-col justify-between">
            <div className="border-t border-border" />
            <div className="border-t border-border/40" />
            <div className="border-t border-border" />
          </div>
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {rows.map((r) => (
              <div
                key={r.key}
                title={`${r.label}: ${formatValue(r.value)}`}
                className="min-w-[3px] flex-1 rounded-t-[3px] bg-primary"
                style={{
                  height: r.value > 0 ? `${Math.max(2, (r.value / max) * 100)}%` : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[3rem_1fr] gap-2">
        <div />
        <div className="flex gap-[2px]">
          {rows.map((r, i) => (
            <span
              key={r.key}
              className="flex-1 overflow-visible text-center text-[0.5625rem] whitespace-nowrap text-muted-foreground"
            >
              {i % 5 === 0 || i === rows.length - 1 ? r.label : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Small pill label reusing the shared theme tokens. */
export function Badge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "green" | "red" | "amber";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "green" && "bg-primary/10 text-primary",
        tone === "red" && "bg-destructive/10 text-destructive",
        tone === "amber" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Horizontal usage bars, one row per day. */
export function DayBars({
  rows,
  formatValue = (v: number) => String(v),
}: {
  rows: { key: string; label: string; value: number }[];
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.key} className="bar-row">
          <span className="text-muted-foreground">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="font-semibold text-foreground">{formatValue(r.value)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No data.</p>}
    </div>
  );
}

/** Server-side pagination controls: page size select + prev/next + totals. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  sizes = [25, 50, 100],
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
  sizes?: number[];
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {total} data · halaman {page} dari {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSize(Number(v))}
          aria-label="Baris per halaman"
          className="h-8 rounded-lg px-2 pr-7 text-xs"
          options={sizes.map((s) => ({ value: String(s), label: `${s}/hal` }))}
        />
        <Button
          size="xs"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Sebelumnya
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}
