import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { isLocale } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown,
  Loader2,
  MessageSquareOff,
  SendHorizontal,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/kit";
import { PRICING_URL } from "@/components/pro-wall";
import {
  COACH_INPUT_LIMITS,
  classifyCoachError,
  parseStored,
  storageKey,
  toPayload,
} from "@/lib/coach/conversation";
import type { ChatMessage, CoachError } from "@/lib/coach/conversation";
import {
  SNAPSHOT_RECOVERY_DAYS,
  SNAPSHOT_WORKOUT_DAYS,
  buildCoachSnapshot,
} from "@/lib/coach/snapshot";
import { client, isPaywall, orpc } from "@/lib/orpc";

const INTRO_QUESTIONS = ["q1", "q2", "q3"] as const;

function readStored(userId: string): ChatMessage[] {
  try {
    return parseStored(window.sessionStorage.getItem(storageKey(userId)));
  } catch {
    return [];
  }
}

function writeStored(userId: string, messages: readonly ChatMessage[]): void {
  try {
    if (messages.length === 0) window.sessionStorage.removeItem(storageKey(userId));
    else window.sessionStorage.setItem(storageKey(userId), JSON.stringify(messages));
  } catch {
    // Storage full or blocked: the conversation stays in memory for this page view.
  }
}

/** The usage line and its bar: messages sent today against the daily cap. */
function Allowance({ used, cap }: { used: number; cap: number }) {
  const { t } = useTranslation("fitWebConnect");
  const left = Math.max(0, cap - used);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
        <span className="font-semibold text-muted-foreground">{t("coach.status.label")}</span>
        <span className="font-bold tabular-nums">{t("coach.status.count", { used, cap })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("coach.status.label")}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Math.min(used, cap)}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", left === 0 ? "bg-warning" : "bg-primary")}
          style={{ width: `${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {left === 0 ? t("coach.status.none") : t("coach.status.left", { count: left })}
      </p>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation("fitWebConnect");
  const mine = message.role === "user";
  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <span className="px-1 text-[0.6875rem] font-semibold text-muted-foreground">
        {mine ? t("coach.log.you") : t("coach.log.coach")}
      </span>
      <div
        className={cn(
          "max-w-[min(100%,40rem)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
          mine
            ? "rounded-br-md bg-primary text-primary-foreground"
            : message.flagged
              ? "rounded-bl-md bg-warning/10 ring-1 ring-warning/30"
              : "rounded-bl-md bg-muted",
        )}
      >
        {message.flagged && (
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-warning">
            <ShieldAlert className="size-3.5" aria-hidden />
            {t("coach.log.flagged")}
          </span>
        )}
        {message.content}
      </div>
    </li>
  );
}

/** A real chat with the JoyoFit coach (`coach.chat`): nothing is stored on the server, the tab keeps the conversation. */
export function CoachChat({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation("fitWebConnect");
  const queryClient = useQueryClient();
  const status = useQuery(orpc.coach.status.queryOptions());
  const [messages, setMessages] = useState<ChatMessage[]>(() => readStored(userId));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<CoachError | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number } | null>(null);
  const [cleared, setCleared] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => writeStored(userId, messages), [userId, messages]);

  const chat = useMutation({
    mutationFn: async (history: readonly ChatMessage[]) => {
      // The snapshot is built from what the web reads, at send time, from cache when it is fresh. A failed read must not
      // block the chat: an empty snapshot is all nulls, and the server reads the rest from the account itself.
      const today = jakartaToday();
      const [recovery, workouts] = await Promise.all([
        queryClient
          .ensureQueryData(
            orpc.fitWeb.recovery.queryOptions({
              input: { from: shiftDate(today, -(SNAPSHOT_RECOVERY_DAYS - 1)), to: today },
            }),
          )
          .catch(() => null),
        queryClient
          .ensureQueryData(
            orpc.fitWeb.workouts.queryOptions({
              input: { from: shiftDate(today, -(SNAPSHOT_WORKOUT_DAYS - 1)), to: today },
            }),
          )
          .catch(() => null),
      ]);
      const snapshot = buildCoachSnapshot({
        today,
        nowMs: Date.now(),
        days: recovery?.days ?? [],
        workouts: workouts?.items ?? [],
      });
      return client.coach.chat({
        messages: toPayload(history),
        snapshot,
        ...(isLocale(i18n.language) ? { locale: i18n.language } : {}),
      });
    },
    onSuccess: (reply) => {
      setMessages((list) => [
        ...list,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply.reply,
          flagged: reply.flagged,
        },
      ]);
      setUsage({ used: reply.used, cap: reply.cap });
      void queryClient.invalidateQueries({ queryKey: orpc.coach.status.key() });
    },
    onError: (failure) => {
      const classified = classifyCoachError(failure);
      setError(classified);
      if (classified.kind === "capReached" && classified.cap !== null) {
        setUsage({ used: classified.cap, cap: classified.cap });
      }
    },
  });

  // Newest message (or the "writing" line) into view.
  const count = messages.length;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, chat.isPending, error]);

  const paywalled =
    isPaywall(status.error) || status.data?.unlocked === false || error?.kind === "paywall";
  const cap = usage?.cap ?? status.data?.chatDailyCap ?? null;
  const used = usage?.used ?? status.data?.chatUsedToday ?? 0;
  const off = cap === 0 || error?.kind === "unavailable";
  const spent = cap !== null && cap > 0 && used >= cap;
  const lastIsUser = messages[messages.length - 1]?.role === "user";
  const tooLong = draft.length > COACH_INPUT_LIMITS.maxMessageChars;
  const canSend = !chat.isPending && !spent && draft.trim() !== "" && !tooLong;

  const send = (text: string) => {
    const content = text.trim();
    if (content === "" || chat.isPending) return;
    const next = [
      ...messages,
      { id: crypto.randomUUID(), role: "user" as const, content, flagged: null },
    ];
    setMessages(next);
    setDraft("");
    setError(null);
    setCleared(false);
    chat.mutate(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter is a new line; Enter that confirms an IME composition is not a send.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) send(draft);
    }
  };

  const clear = () => {
    setMessages([]);
    setError(null);
    setCleared(true);
    chat.reset();
    inputRef.current?.focus();
  };

  if (paywalled) {
    return (
      <Card>
        <CardHeader title={t("coach.locked.title")} />
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-muted/60 p-4">
          <span className="grid size-10 place-items-center rounded-full bg-card text-warning">
            <Crown className="size-5" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">
            {error?.kind === "paywall" ? t("coach.error.paywall") : t("coach.locked.body")}
          </p>
          <Button size="sm" nativeButton={false} render={<a href={PRICING_URL} />}>
            {t("coach.locked.cta")}
          </Button>
        </div>
      </Card>
    );
  }

  if (off) {
    return (
      <Card>
        <CardHeader title={t("coach.disabled.title")} />
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-muted/60 p-4">
          <span className="grid size-10 place-items-center rounded-full bg-card text-muted-foreground">
            <MessageSquareOff className="size-5" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">
            {error?.kind === "unavailable"
              ? t("coach.error.unavailable")
              : t("coach.disabled.body")}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader
        className="mb-0"
        title={t("coach.log.label")}
        action={
          <Button
            variant="ghost"
            size="sm"
            disabled={messages.length === 0 && !chat.isPending}
            onClick={clear}
          >
            <Trash2 aria-hidden />
            {t("coach.clear.action")}
          </Button>
        }
      />
      {cap !== null ? (
        <Allowance used={used} cap={cap} />
      ) : status.isError ? (
        <p className="text-xs text-muted-foreground">{t("coach.status.loadError")}</p>
      ) : null}

      <div
        ref={logRef}
        role="log"
        aria-label={t("coach.log.label")}
        aria-live="polite"
        aria-relevant="additions text"
        className="h-[min(30rem,60svh)] min-h-64 overflow-y-auto rounded-2xl bg-card p-1 ring-1 ring-foreground/10"
      >
        {messages.length === 0 && !chat.isPending ? (
          <div className="flex h-full flex-col justify-center gap-3 p-3">
            <div>
              <h3 className="text-sm font-bold">{t("coach.intro.title")}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("coach.intro.body")}</p>
            </div>
            <ul className="flex flex-col items-start gap-2">
              {INTRO_QUESTIONS.map((key) => (
                <li key={key} className="max-w-full">
                  <button
                    type="button"
                    disabled={spent}
                    onClick={() => send(t(`coach.intro.${key}`))}
                    className="min-h-10 rounded-2xl bg-muted px-3.5 py-2 text-left text-sm font-medium break-words transition-colors outline-none hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
                  >
                    {t(`coach.intro.${key}`)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="flex flex-col gap-3 p-3">
            {messages.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
            {chat.isPending && (
              <li className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                {t("coach.log.thinking")}
              </li>
            )}
          </ul>
        )}
      </div>

      <div role="status" aria-live="polite" className="empty:hidden">
        {cleared && messages.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("coach.clear.done")}</p>
        )}
      </div>

      {error && error.kind !== "paywall" && error.kind !== "unavailable" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="min-w-0 flex-1 break-words">
            {error.kind === "capReached"
              ? error.cap !== null
                ? t("coach.error.capReached", { cap: error.cap })
                : t("coach.error.capReachedNoCap")
              : error.kind === "failed"
                ? (error.message ?? t("coach.error.failed"))
                : t("coach.error.network")}
          </p>
          {error.kind !== "capReached" && lastIsUser && (
            <Button
              variant="outline"
              size="sm"
              disabled={chat.isPending}
              onClick={() => {
                setError(null);
                chat.mutate(messages);
              }}
            >
              {t("coach.error.retry")}
            </Button>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) send(draft);
        }}
        className="flex flex-col gap-1.5"
      >
        <label htmlFor="coach-input" className="sr-only">
          {t("coach.input.label")}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            id="coach-input"
            value={draft}
            rows={2}
            disabled={spent}
            aria-invalid={tooLong}
            aria-describedby="coach-input-hint"
            placeholder={t("coach.input.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-40 min-h-[3.25rem] min-w-0 flex-1 resize-none rounded-2xl border border-transparent bg-muted px-4 py-3 text-base [field-sizing:content] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/60"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label={chat.isPending ? t("coach.input.sending") : t("coach.input.send")}
          >
            {chat.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <SendHorizontal aria-hidden />
            )}
          </Button>
        </div>
        <p
          id="coach-input-hint"
          className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"
        >
          <span>{t("coach.input.hint")}</span>
          {draft.length > COACH_INPUT_LIMITS.maxMessageChars * 0.8 && (
            <span className={cn("tabular-nums", tooLong && "font-bold text-destructive")}>
              {tooLong
                ? t("coach.input.tooLong", { max: COACH_INPUT_LIMITS.maxMessageChars })
                : t("coach.input.counter", {
                    used: draft.length,
                    max: COACH_INPUT_LIMITS.maxMessageChars,
                  })}
            </span>
          )}
        </p>
      </form>
    </Card>
  );
}

/** What goes with a message, the safety line and where the conversation lives. */
export function CoachAside() {
  const { t } = useTranslation("fitWebConnect");
  const context = ["workouts", "recovery", "sleep", "strain", "server"] as const;
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader
        className="mb-0"
        title={t("coach.context.title")}
        subtitle={t("coach.context.body")}
      />
      <ul className="flex flex-col gap-2 text-sm">
        {context.map((key) => (
          <li key={key} className="flex gap-2.5 leading-relaxed">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 break-words">{t(`coach.context.${key}`)}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2.5 rounded-2xl bg-warning/10 p-3.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="text-xs leading-relaxed">{t("coach.safety")}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("coach.memory")}</p>
    </Card>
  );
}
