import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { displayTitle } from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { ChatStore, ConversationMeta } from "@joyorogo/api/lib/joyo-ai/conversations";

/** The conversations kept in this browser: open one, delete one (asked once), or delete them all. */
export function HistorySheet({
  open,
  onOpenChange,
  store,
  currentId,
  onOpen,
  onRemoved,
  onDeleteAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: ChatStore;
  currentId: string | null;
  onOpen: (id: string) => void;
  onRemoved: (id: string) => void;
  onDeleteAll: () => void;
}) {
  const { t, i18n } = useTranslation("joyoAiWeb");
  const [list, setList] = useState<ConversationMeta[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => void store.list().then((next) => live && setList(next));
    load();
    const off = store.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [open, store]);

  useEffect(() => {
    if (!open) setConfirming(null);
  }, [open]);

  const date = (at: number) =>
    new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" }).format(new Date(at));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("history.title")} description={t("history.description")}>
      {list === null ? null : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("history.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {list.map((chat) => (
            <li key={chat.id} className="flex items-center gap-1">
              {confirming === chat.id ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="min-w-0 flex-1"
                    onClick={() => {
                      setConfirming(null);
                      void store.remove(chat.id).then(() => onRemoved(chat.id));
                    }}
                  >
                    {t("history.delete")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                    {t("history.cancel")}
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-current={chat.id === currentId ? "true" : undefined}
                    onClick={() => {
                      onOpen(chat.id);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "min-h-12 min-w-0 flex-1 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                      chat.id === currentId && "bg-muted",
                    )}
                  >
                    <span className="block truncate text-[0.9375rem] font-semibold">
                      {displayTitle(chat.title, t("chat.newTitle"))}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {t("history.messages", { count: chat.messageCount })} · {date(chat.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("history.delete")}
                    title={t("history.delete")}
                    onClick={() => setConfirming(chat.id)}
                    className="pressable inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <Trash2 aria-hidden className="size-[1.125rem]" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {list !== null && list.length > 0 ? (
        <Button variant="destructive" className="mt-4 w-full" onClick={onDeleteAll}>
          {t("history.deleteAll")}
        </Button>
      ) : null}
    </Sheet>
  );
}
