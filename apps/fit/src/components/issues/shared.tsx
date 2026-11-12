import { Button } from "@joyorogo/ui/components/button";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { cn } from "@joyorogo/ui/lib/utils";
import { Send } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { MAX_COMMENT_CHARS } from "@/lib/issues";

/** The team's workflow state, as Atur names and colours it ("Backlog", "In Progress", "Done"). */
export function StateBadge({
  name,
  color,
  className,
}: {
  name: string | null | undefined;
  color: string | null | undefined;
  className?: string;
}) {
  if (!name) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: color ?? "currentColor" }}
      />
      {name}
    </span>
  );
}

/** "12 Nov 2026" in the app's language. */
export function useFmtDate(): (iso: string | null | undefined) => string {
  const { i18n } = useTranslation();
  const fmt = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (iso) => {
    if (!iso) return "";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : fmt.format(date);
  };
}

/** A comment or reply box. `onSend` rejects to keep the text (the parent shows the error). */
export function CommentForm({
  label,
  placeholder,
  pending,
  onSend,
}: {
  label: string;
  placeholder: string;
  pending: boolean;
  onSend: (body: string) => Promise<unknown>;
}) {
  const { t } = useTranslation("fitWebIssues");
  const [text, setText] = useState("");
  const id = useId();
  const trimmed = text.trim();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed || pending) return;
        void onSend(trimmed).then(
          () => setText(""),
          () => {},
        );
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Textarea
        id={id}
        value={text}
        maxLength={MAX_COMMENT_CHARS}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        className="min-h-20"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {text.length > MAX_COMMENT_CHARS - 400 ? `${text.length}/${MAX_COMMENT_CHARS}` : ""}
        </span>
        <Button type="submit" size="sm" disabled={!trimmed || pending}>
          <Send aria-hidden />
          {pending ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}
