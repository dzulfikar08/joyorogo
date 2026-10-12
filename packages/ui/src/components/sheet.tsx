import { Drawer } from "@base-ui/react/drawer";
import { cn } from "@joyorogo/ui/lib/utils";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Bottom sheet for every "add/edit" form. Swipe down, tap the backdrop, Esc,
 * or the close button dismisses it. On desktop it stays a bottom sheet but is
 * capped to a readable width.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Optional element that opens the sheet (rendered via Drawer.Trigger render prop). */
  trigger?: React.ReactElement;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger && <Drawer.Trigger render={trigger} />}
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-black opacity-[calc(0.35*(1-var(--drawer-swipe-progress,0)))] transition-opacity duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 dark:opacity-[calc(0.6*(1-var(--drawer-swipe-progress,0)))]" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <Drawer.Popup
            className={cn(
              "-mb-12 max-h-[calc(90dvh+3rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[28px] bg-card px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px)+3rem)] text-card-foreground shadow-float outline-none",
              "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-transform duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
              "data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)] data-swiping:select-none data-swiping:duration-0",
              "motion-reduce:transition-none",
            )}
          >
            <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
            <Drawer.Content className="mx-auto w-full">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Drawer.Title className="text-xl font-bold tracking-tight">{title}</Drawer.Title>
                  {description && (
                    <Drawer.Description className="mt-1 text-sm text-muted-foreground">
                      {description}
                    </Drawer.Description>
                  )}
                </div>
                <Drawer.Close
                  aria-label="Tutup"
                  className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <X className="size-5" aria-hidden />
                </Drawer.Close>
              </div>
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
