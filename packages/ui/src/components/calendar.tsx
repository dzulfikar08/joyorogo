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
        months: "relative flex flex-col sm:flex-row gap-2",
        month_caption: "flex justify-center relative items-center h-10",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "size-10 p-0 aria-disabled:opacity-50",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "size-10 p-0 aria-disabled:opacity-50",
        ),
        month_grid: "mx-auto mt-2 border-collapse",
        weekdays: "flex",
        weekday: "text-muted-foreground w-10 font-normal text-[0.8rem]",
        week: "flex w-full mt-1",
        day: "relative w-10 h-10 text-center text-sm p-0",
        day_button: "size-10 rounded-md p-0 font-normal hover:bg-muted",
        selected: "rounded-md bg-primary text-primary-foreground hover:bg-primary",
        today: "rounded-md bg-muted text-foreground font-semibold",
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
