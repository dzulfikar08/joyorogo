import { Button, buttonVariants } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import * as RPD from "react-day-picker";
import * as React from "react";

/** shadcn-style calendar on react-day-picker v9, themed by the app tokens. */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof RPD.DayPicker>) {
  return (
    <RPD.DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "size-7 absolute left-1 p-0 aria-disabled:opacity-50",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "size-7 absolute right-1 p-0 aria-disabled:opacity-50",
        ),
        month_grid: "mt-4 border-collapse",
        weekdays: "flex",
        weekday: "text-muted-foreground w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-1",
        day: "relative w-9 h-9 text-center text-sm p-0",
        day_button: "size-9 rounded-md p-0 font-normal hover:bg-muted",
        selected: "bg-primary text-primary-foreground hover:bg-primary",
        today: "bg-muted text-foreground font-semibold",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}

export { Calendar };
void Button;
