import { OptionList, type Option } from "@joyorogo/ui/components/option-list";
import { Overlay } from "@joyorogo/ui/components/overlay";
import { cn } from "@joyorogo/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export type { Option };

const TRIGGER =
  "inline-flex h-10 min-w-0 items-center justify-between gap-2 rounded-full border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-expanded:bg-muted disabled:pointer-events-none disabled:opacity-50";

/** Search shows from this many options on; a short list reads faster without a field. */
export const SEARCH_FROM = 9;

/**
 * Pick one. A listbox in a popover on desktop, in a bottom sheet on phones (a native `<select>` is neither styleable
 * nor searchable). Long lists get a search field.
 */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  searchLabel,
  noResults,
  searchable,
  className,
  triggerLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly Option<T>[];
  /** Names the control (screen readers) and titles the sheet. */
  label: string;
  searchLabel?: string;
  noResults?: string;
  /** Force the search field on or off; default: on from SEARCH_FROM options. */
  searchable?: boolean;
  className?: string;
  /** Replaces the selected option's label on the trigger. */
  triggerLabel?: ReactNode;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Overlay
      title={label}
      trigger={
        <button type="button" aria-label={label} className={cn(TRIGGER, className)}>
          <span className="min-w-0 truncate">{triggerLabel ?? current?.label}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <OptionList
          options={options}
          selected={[value]}
          label={label}
          searchLabel={searchLabel}
          noResults={noResults}
          searchable={searchable ?? options.length >= SEARCH_FROM}
          onPick={(next) => {
            onChange(next);
            close();
          }}
        />
      )}
    </Overlay>
  );
}

/** Pick several; stays open while picking. The trigger says how many. */
export function MultiSelect<T extends string | number>({
  values,
  onChange,
  options,
  label,
  triggerLabel,
  footer,
  className,
}: {
  values: readonly T[];
  onChange: (values: T[]) => void;
  options: readonly Option<T>[];
  label: string;
  triggerLabel: ReactNode;
  footer?: (close: () => void) => ReactNode;
  className?: string;
}) {
  return (
    <Overlay
      title={label}
      trigger={
        <button type="button" aria-label={label} className={cn(TRIGGER, className)}>
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <>
          <OptionList
            options={options}
            selected={values}
            multiple
            label={label}
            onPick={(next) =>
              onChange(values.includes(next) ? values.filter((v) => v !== next) : [...values, next])
            }
          />
          {footer?.(close)}
        </>
      )}
    </Overlay>
  );
}
