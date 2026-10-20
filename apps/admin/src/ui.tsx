import { Select as SelectPrimitive } from "@base-ui/react/select";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Button as UiButton } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RotateCw,
  Search,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { errorMessage } from "./api";

/** Shared button with a 44px minimum tap target on touch and narrow screens. */
export function Button({ className, ...props }: ComponentProps<typeof UiButton>) {
  return <UiButton className={cn("max-md:min-h-11 pointer-coarse:min-h-11", className)} {...props} />;
}

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
          "flex h-12 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-xl border border-transparent bg-muted px-3 text-[0.9375rem] whitespace-nowrap text-foreground transition-[border-color,box-shadow,background-color] outline-none focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:border-ring/60 data-popup-open:bg-card data-popup-open:ring-[3px] data-popup-open:ring-ring/25 sm:text-base",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Value className="truncate" />
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

/** Confirm dialog for consequential actions: trigger button + Batal/Ya popup. */
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
        <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-black/50" />
        <AlertDialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-[60] w-[min(26rem,calc(100dvw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 text-foreground shadow-lg outline-none">
          <AlertDialogPrimitive.Title className="text-base font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2 max-sm:[&>*]:flex-1">
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
    <div className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-foreground sm:text-2xl">{value}</div>
      {hint && <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  flush = false,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  /** No body padding: for lists/tables that run edge to edge. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </header>
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/** Compact numeric table: scrolls sideways on phones with the first column pinned. */
export function StatTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="table-wrap table-sticky">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i > 0 ? "text-right" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
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

// ---- lists: states, responsive rows, search, pagination ----

export function StateMessage({
  icon: Icon = Inbox,
  title,
  description,
  tone = "muted",
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  tone?: "muted" | "error";
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex flex-col items-center gap-2 px-4 py-10 text-center"
    >
      <span
        className={cn(
          "grid size-11 place-items-center rounded-full",
          tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/** Loading placeholder shaped like list rows. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" role="status" aria-label="Memuat data" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

type QueryLike<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isPlaceholderData?: boolean;
  refetch: () => unknown;
};

/**
 * One loading / error / empty treatment for every query-backed list. A failed
 * background refresh keeps the last data on screen under a retry banner.
 */
export function QueryBoundary<T>({
  query,
  isEmpty,
  empty,
  skeletonRows,
  children,
}: {
  query: QueryLike<T>;
  isEmpty: (data: T) => boolean;
  empty: { title: string; description?: ReactNode; icon?: LucideIcon };
  skeletonRows?: number;
  children: (data: T) => ReactNode;
}) {
  const retry = (
    <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
      <RotateCw className="size-4" />
      Coba lagi
    </Button>
  );
  if (query.data === undefined) {
    if (query.isError) {
      return (
        <StateMessage
          tone="error"
          icon={TriangleAlert}
          title="Gagal memuat data"
          description={errorMessage(query.error)}
          action={retry}
        />
      );
    }
    return <ListSkeleton rows={skeletonRows} />;
  }
  if (isEmpty(query.data)) return <StateMessage {...empty} />;
  return (
    <div
      aria-busy={query.isPlaceholderData || undefined}
      className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}
    >
      {query.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <span>Gagal memperbarui: {errorMessage(query.error)}</span>
          {retry}
        </div>
      )}
      {children(query.data)}
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-aligned, no-wrap: amounts and counts. */
  numeric?: boolean;
  /** Keep the cell on one line: dates, ids, counts. */
  nowrap?: boolean;
  /** Makes the header a sort button (needs DataList `sort`); the key the server sorts by. */
  sortKey?: string;
  className?: string;
};

/** Active sort of a DataList: clicking a sortable header calls `onSort` with its key. */
export type ListSort = {
  key: string;
  dir: "asc" | "desc";
  onSort: (key: string) => void;
};

// Literal class names so Tailwind sees them: table at/above the container width, cards below.
const SWITCH = {
  md: { table: "hidden @md:block", cards: "@md:hidden" },
  xl: { table: "hidden @xl:block", cards: "@xl:hidden" },
  "3xl": { table: "hidden @3xl:block", cards: "@3xl:hidden" },
  "5xl": { table: "hidden @5xl:block", cards: "@5xl:hidden" },
} as const;

const activateOnKey = (onActivate: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onActivate();
  }
};

/**
 * Entity list that is a table when its container is wide and stacked cards
 * when it is narrow (container queries, so the user sheet gets cards while
 * the full page gets the table).
 */
export function DataList<T>({
  rows,
  rowKey,
  columns,
  card,
  onRowClick,
  rowLabel,
  sort,
  switchAt = "5xl",
}: {
  rows: T[];
  rowKey: (row: T, index: number) => string;
  columns: Column<T>[];
  card: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  /** Accessible name of a clickable row. */
  rowLabel?: (row: T) => string;
  sort?: ListSort;
  switchAt?: keyof typeof SWITCH;
}) {
  const at = SWITCH[switchAt];
  return (
    <div className="@container">
      <div className={cn("table-wrap", at.table)}>
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(c.numeric && "text-right")}
                  aria-sort={
                    sort && c.sortKey === sort.key
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {sort && c.sortKey ? (
                    <button
                      type="button"
                      onClick={() => sort.onSort(c.sortKey!)}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded font-semibold outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                        c.sortKey === sort.key && "text-foreground",
                      )}
                    >
                      {c.header}
                      {c.sortKey === sort.key &&
                        (sort.dir === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        ))}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                {...(onRowClick && {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": rowLabel?.(row),
                  className: "cursor-pointer",
                  onClick: () => onRowClick(row),
                  onKeyDown: activateOnKey(() => onRowClick(row)),
                })}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      c.numeric && "text-right tabular-nums",
                      (c.numeric || c.nowrap) && "whitespace-nowrap",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CardList
        rows={rows}
        rowKey={rowKey}
        card={card}
        onRowClick={onRowClick}
        rowLabel={rowLabel}
        className={at.cards}
      />
    </div>
  );
}

/** Stacked cards: the narrow-screen half of DataList, also used alone where a table never fits (the user sheet). */
export function CardList<T>({
  rows,
  rowKey,
  card,
  onRowClick,
  rowLabel,
  className,
}: {
  rows: T[];
  rowKey: (row: T, index: number) => string;
  card: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {rows.map((row, i) => (
        <li key={rowKey(row, i)}>
          {onRowClick ? (
            <button
              type="button"
              aria-label={rowLabel?.(row)}
              onClick={() => onRowClick(row)}
              className="block min-h-11 w-full px-4 py-3 text-left transition-colors hover:bg-muted active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              {card(row)}
            </button>
          ) : (
            <div className="px-4 py-3">{card(row)}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Label/value pairs for card bodies. */
export function CardFacts({ facts }: { facts: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      {facts.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-muted-foreground">{f.label}</dt>
          <dd className="font-medium break-words text-foreground tabular-nums">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Search field that writes to the URL 300ms after typing stops; follows URL changes (back/forward). */
export function SearchBox({
  value,
  onSearch,
  placeholder,
  label,
}: {
  value: string;
  onSearch: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  useEffect(() => {
    if (text.trim() === value) return;
    const t = setTimeout(() => onSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative min-w-0 flex-1 basis-60">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pr-12 pl-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          aria-label="Hapus pencarian"
          onClick={() => {
            setText("");
            onSearch("");
          }}
          className="absolute top-1/2 right-0.5 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** Server-side pagination controls: range + total, page size select, prev/next. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  sizes = [10, 25, 50, 100],
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
  sizes?: number[];
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const fmt = new Intl.NumberFormat("id-ID");
  return (
    <nav
      aria-label="Halaman"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground"
    >
      <span className="tabular-nums">
        {fmt.format(from)}–{fmt.format(to)} dari {fmt.format(total)}
      </span>
      <div className="flex items-center gap-2">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSize(Number(v))}
          aria-label="Baris per halaman"
          className="h-9 rounded-lg px-2 pr-7 text-xs max-md:h-11"
          options={sizes.map((s) => ({ value: String(s), label: `${s}/hal` }))}
        />
        <Button
          size="icon-xs"
          variant="outline"
          aria-label="Halaman sebelumnya"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="max-md:size-11 pointer-coarse:size-11"
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-14 text-center tabular-nums">
          {fmt.format(page)} / {fmt.format(totalPages)}
        </span>
        <Button
          size="icon-xs"
          variant="outline"
          aria-label="Halaman berikutnya"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="max-md:size-11 pointer-coarse:size-11"
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
