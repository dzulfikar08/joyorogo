import { useLayoutEffect, useRef } from "react";

import { formatIdrInput, idrCaret, idrKeystroke } from "@joyorogo/api/lib/format";

import { Input } from "@joyorogo/ui/components/input";

/**
 * Rupiah field: the parent keeps plain digits ("15000") while the input shows
 * "Rp15.000" live. The caret stays glued to the digit being edited, so the
 * inserted thousand-separators never swallow the next keystroke.
 */
export function IdrInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (digits: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Caret to restore after React commits the reformatted value.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pendingCaret.current === null) return;
    const pos = Math.min(pendingCaret.current, el.value.length);
    pendingCaret.current = null;
    el.setSelectionRange(pos, pos);
  });

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={formatIdrInput(value)}
      onChange={() => {
        const el = ref.current;
        if (!el) return;
        const raw = el.value;
        const caret = el.selectionStart ?? raw.length;
        const digits = idrKeystroke(raw, formatIdrInput(value), caret);
        pendingCaret.current = idrCaret(formatIdrInput(digits), raw, caret);
        onChange(digits);
        // React only rewrites the DOM when the state changes; a typed
        // separator is a no-op for the digits, so sync it here instead.
        const display = formatIdrInput(digits);
        if (el.value !== display) el.value = display;
      }}
      className={className}
      {...props}
    />
  );
}
