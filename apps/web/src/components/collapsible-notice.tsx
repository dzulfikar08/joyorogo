import { cn } from "@joyorogo/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { setNoticeExpanded, useNoticeExpanded } from "@/lib/notice-store";

/**
 * A Beranda notice folded to one row: icon and title. Opening it shows the full text and actions and is remembered per
 * `id` on this device. `action` sits beside the toggle (a close button), so it stays reachable while collapsed.
 */
export function CollapsibleNotice({
  id,
  title,
  icon,
  action,
  className,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation("home");
  const open = useNoticeExpanded(id);
  const bodyId = useId();
  return (
    <Card className={cn("p-0", className)}>
      <div className="flex items-center pr-1">
        <h2 className="min-w-0 flex-1 text-[0.9375rem] font-bold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            title={open ? t("notice.collapse") : t("notice.expand")}
            onClick={() => setNoticeExpanded(id, !open)}
            className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-3xl px-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <span aria-hidden className="shrink-0 text-bakar [&>svg]:size-5">
              {icon}
            </span>
            <span className={cn("min-w-0 flex-1", open ? "leading-snug" : "truncate")}>{title}</span>
            <ChevronDown
              className={cn(
                "size-5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </h2>
        {action}
      </div>
      <div id={bodyId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </Card>
  );
}
