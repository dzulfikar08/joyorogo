import { Popover, PopoverContent, PopoverTrigger } from "@joyorogo/ui/components/popover";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useIsPhone } from "@joyorogo/ui/hooks/use-media-query";
import { cn } from "@joyorogo/ui/lib/utils";
import { type ReactElement, type ReactNode, useState } from "react";

/**
 * One menu surface for two screens: an anchored popover from 640 px up (flips and shifts to stay on screen, Esc or an
 * outside tap closes it, focus returns to the trigger), a bottom sheet below that (drag handle, safe-area padding,
 * scroll lock, swipe or tap outside to close). `children` is a function so the content can close the overlay.
 */
export function Overlay({
  trigger,
  title,
  description,
  children,
  align = "start",
  open: openProp,
  onOpenChange,
  contentClassName,
}: {
  /** The element that opens it. Desktop: wrapped by the popover trigger (must forward refs and props). */
  trigger: ReactElement;
  /** Sheet title on phones, accessible name on desktop. */
  title: string;
  description?: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contentClassName?: string;
}) {
  const phone = useIsPhone();
  const [inner, setInner] = useState(false);
  const open = openProp ?? inner;
  const setOpen = (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  };
  const close = () => setOpen(false);

  if (phone) {
    return (
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        trigger={trigger}
      >
        {open ? children(close) : null}
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        collisionPadding={12}
        aria-label={title}
        // The list inside takes focus itself (it knows which row to start on).
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          "flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) min-w-52 flex-col rounded-2xl p-1.5 shadow-float",
          contentClassName,
        )}
      >
        {children(close)}
      </PopoverContent>
    </Popover>
  );
}
