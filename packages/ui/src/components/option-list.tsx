import { cn } from "@joyorogo/ui/lib/utils";
import { Check, Search } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

export interface Option<T extends string | number = string> {
  value: T;
  label: string;
  /** Shown after the label, quieter (a count, a unit). */
  hint?: ReactNode;
  disabled?: boolean;
}

/**
 * A listbox: Up/Down/Home/End move, Enter or Space picks, typing jumps to the first label that starts with it (or
 * filters, with `searchable`). Focus stays on one element (the list, or the search input) and the active row is
 * announced through `aria-activedescendant`, so it behaves the same inside a popover and inside a bottom sheet.
 */
export function OptionList<T extends string | number>({
  options,
  selected,
  onPick,
  multiple = false,
  searchable = false,
  searchLabel,
  noResults,
  label,
  autoFocus = true,
  className,
}: {
  options: readonly Option<T>[];
  selected: readonly T[];
  onPick: (value: T) => void;
  multiple?: boolean;
  searchable?: boolean;
  searchLabel?: string;
  noResults?: string;
  /** Accessible name of the list. */
  label: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : options;
  }, [options, query]);
  const firstSelected = shown.findIndex((o) => selected.includes(o.value));
  const [active, setActive] = useState(Math.max(0, firstSelected));
  const listRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement | HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (autoFocus) focusRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(() => {
    setActive(query ? 0 : Math.max(0, shown.findIndex((o) => selected.includes(o.value))));
    // Re-seat on a new filter only; picking must not move the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const move = (to: number) => {
    const last = shown.length - 1;
    if (last < 0) return;
    let next = Math.min(Math.max(to, 0), last);
    const step = to >= active ? 1 : -1;
    while (shown[next]?.disabled && next + step >= 0 && next + step <= last) next += step;
    setActive(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        return move(active + 1);
      case "ArrowUp":
        event.preventDefault();
        return move(active - 1);
      case "Home":
        if (searchable) return;
        event.preventDefault();
        return move(0);
      case "End":
        if (searchable) return;
        event.preventDefault();
        return move(shown.length - 1);
      case "Enter":
      case " ": {
        if (event.key === " " && searchable && query) return;
        const option = shown[active];
        if (!option || option.disabled) return;
        event.preventDefault();
        onPick(option.value);
        return;
      }
    }
    if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = Date.now();
      const state = typed.current;
      state.text = now - state.at > 700 ? event.key : state.text + event.key;
      state.at = now;
      const text = state.text.toLocaleLowerCase();
      const hit = shown.findIndex((o) => o.label.toLocaleLowerCase().startsWith(text));
      if (hit >= 0) setActive(hit);
    }
  };

  const optionId = (index: number) => `${id}-o${index}`;
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {searchable && (
        <div className="relative mb-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={focusRef as React.RefObject<HTMLInputElement>}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={`${id}-list`}
            aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
            aria-label={searchLabel ?? label}
            placeholder={searchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            className="h-10 w-full rounded-full border border-input bg-background pr-3 pl-9 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm"
          />
        </div>
      )}
      <div
        id={`${id}-list`}
        ref={(node) => {
          listRef.current = node;
          if (!searchable) (focusRef as React.RefObject<HTMLDivElement | null>).current = node;
        }}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        aria-activedescendant={!searchable && shown.length > 0 ? optionId(active) : undefined}
        tabIndex={searchable ? -1 : 0}
        onKeyDown={searchable ? undefined : onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{noResults}</p>
        )}
        {shown.map((option, index) => {
          const on = selected.includes(option.value);
          return (
            <div
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={on}
              aria-disabled={option.disabled || undefined}
              data-index={index}
              data-active={index === active || undefined}
              onPointerMove={() => index !== active && setActive(index)}
              onClick={() => !option.disabled && onPick(option.value)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm select-none sm:min-h-9",
                "data-active:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                on ? "font-semibold text-foreground" : "text-foreground/90",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-4 shrink-0 place-items-center",
                  multiple && "rounded border border-input",
                  multiple && on && "border-primary bg-primary text-primary-foreground",
                  !multiple && "text-primary",
                )}
              >
                {on && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {option.hint != null && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {option.hint}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
