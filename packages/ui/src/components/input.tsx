import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@joyorogo/ui/lib/utils";
import * as React from "react";

// v2: filled field (no outline at rest), 48px tall, 16px text so iOS
// Safari never zooms on focus; focus shows the brand ring.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-xl border border-transparent bg-muted px-4 text-base text-foreground tabular-nums transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/60 aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
