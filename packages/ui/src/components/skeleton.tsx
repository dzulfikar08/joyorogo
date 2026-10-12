import { cn } from "@joyorogo/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-xl bg-foreground/[0.07] motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
