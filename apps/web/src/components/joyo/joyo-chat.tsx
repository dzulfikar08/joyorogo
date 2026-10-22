import { cn } from "@joyorogo/ui/lib/utils";
import { Button } from "@joyorogo/ui/components/button";
import { ArrowDown, History, SquarePen } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  assistantMessage,
  createCoalescer,
  initialLive,
  lastIndexOfRole,
  partialOnStop,
  reduceLive,
} from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { LiveState } from "@joyorogo/api/lib/joyo-ai/chat-state";
import { CONSENT_VERSION } from "@joyorogo/api/lib/joyo-ai/consent";
import type { ChatMessage } from "@joyorogo/api/lib/joyo-ai/conversations";
import { finishReply, mentionsMaternal } from "@joyorogo/api/lib/joyo-ai/safety";
import type { SafetyText } from "@joyorogo/api/lib/joyo-ai/safety";
import { isLocale } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { jakartaToday } from "@joyorogo/api/lib/engine";

import { ConfirmSheet } from "@/components/profil/confirm-sheet";
import {
  MAX_MESSAGE_CHARS,
  classifyJoyoError,
  failureKey,
  hostedInput,
} from "@/lib/joyo-chat";
import type { JoyoFailure } from "@/lib/joyo-chat";
import { joyoChats } from "@/lib/joyo-store";
import { client } from "@/utils/orpc";

import { Composer } from "./composer";
import { HistorySheet } from "./history-sheet";
import { AssistantMessage, UserMessage } from "./message";
import { useFollowScroll } from "./use-follow-scroll";

/** How often the growing text is drawn: a fast stream is read into a ref at full speed and committed at most this often. */
const COMMIT_MS = 50;

type HostedEvent = Awaited<ReturnType<typeof client.joyo.chat>> extends AsyncIterable<infer E> ? E : never;
type HostedDone = Extract<HostedEvent, { type: "done" }>["result"];

const SUGGESTIONS = ["fiber", "remaining", "weight"] as const;

/** A callback with a stable identity that always calls the latest closure, so memoised messages are not redrawn by every token. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

export interface ChatBodyProps {
  /** An entry point's question: opens a new chat with it typed in (never sent by itself). */
  ask: string | undefined;
  /** Called once the `ask` search param was taken into the composer, so the page can drop it from the URL. */
  onAskTaken: () => void;
  /** `used`/`cap` of the hosted engine today, from the status read and after each answer. */
  usage: { used: number; cap: number } | null;
  onUsage: (used: number, cap: number) => void;
  /** The server refused the call for a reason that changes what the page shows. */
  onRefused: (failure: Extract<JoyoFailure, { kind: "paywall" | "minor" | "noConsent" }>) => void;
}

function Notice({ tone = "muted", children, onClose, closeLabel }: { tone?: "muted" | "danger"; children: ReactNode; onClose?: () => void; closeLabel?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-2xl px-4 py-3 text-sm leading-relaxed",
        tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md text-xs font-semibold underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {closeLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Joyo AI, the chat itself (the hosted engine; the page has already checked Pro, age and consent). Conversations live in this
 * browser's localStorage. The writing answer and the finished one are the same element, so nothing is rebuilt when the last
 * token arrives.
 */
export function ChatBody({ ask, onAskTaken, usage, onUsage, onRefused }: ChatBodyProps) {
  const { t, i18n } = useTranslation("joyoAiWeb");
  const { t: tAi } = useTranslation("joyoAi");
  const locale: Locale = isLocale(i18n.language) ? i18n.language : "id";
  const { away, awayRef, toBottom } = useFollowScroll();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [loaded, setLoaded] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const idRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  const [text, setText] = useState("");
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const liveRef = useRef<LiveState>(initialLive());
  const liveId = useRef("live");
  const [failure, setFailure] = useState<JoyoFailure | null>(null);
  const [toolsOff, setToolsOff] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  // Why the request was aborted: "user" keeps what arrived; "switch" (another chat opened, page left) ends quietly.
  const stopped = useRef<"user" | "switch" | null>(null);
  // An answer that finishes after another chat was opened must not touch the screen.
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = "switch";
      controller.current?.abort();
    };
  }, []);

  const persist = useCallback((id: string, next: readonly ChatMessage[]) => {
    void joyoChats.setMessages(id, next).catch(() => undefined);
  }, []);

  const setChat = useCallback((id: string | null, next: ChatMessage[]) => {
    idRef.current = id;
    messagesRef.current = next;
    setConversationId(id);
    setMessages(next);
  }, []);
  const setList = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  /** Shows a saved conversation, or an empty new one for null. A running answer is dropped quietly. */
  const open = useCallback(
    (id: string | null, conversation: { id: string; messages: ChatMessage[] } | null) => {
      generation.current += 1;
      stopped.current = "switch";
      controller.current?.abort();
      setChat(conversation ? conversation.id : id, conversation?.messages ?? []);
      sendingRef.current = false;
      setSending(false);
      setLive(null);
      setText("");
      setEditing(null);
      setFailure(null);
      setToolsOff(false);
      toBottom();
    },
    [setChat, toBottom],
  );

  const startNew = useCallback(() => {
    void joyoChats.setCurrent(null).catch(() => undefined);
    open(null, null);
  }, [open]);

  const openSaved = useCallback(
    (id: string) => {
      void joyoChats.setCurrent(id).catch(() => undefined);
      void joyoChats.get(id).then((conversation) => {
        if (mounted.current) open(id, conversation);
      });
    },
    [open],
  );

  // First paint of the page: the chat the person had open last, or (from an entry point) a new one with the question typed in.
  const appliedAsk = useRef<string | null>(null);
  const firstLoad = useRef(false);
  useEffect(() => {
    if (ask !== undefined) {
      if (appliedAsk.current === ask) return;
      appliedAsk.current = ask;
      firstLoad.current = true;
      startNew();
      setText(ask);
      setFocusTick((n) => n + 1);
      setLoaded(true);
      onAskTaken();
      return;
    }
    if (firstLoad.current) return;
    firstLoad.current = true;
    void (async () => {
      try {
        const id = await joyoChats.current();
        const conversation = id ? await joyoChats.get(id) : null;
        if (mounted.current) setChat(conversation ? conversation.id : null, conversation?.messages ?? []);
      } finally {
        if (mounted.current) {
          setLoaded(true);
          toBottom();
        }
      }
    })();
  }, [ask, onAskTaken, startNew, setChat, toBottom]);

  useEffect(() => {
    if (focusTick === 0 || !loaded) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusTick, loaded]);

  const safetyText: SafetyText = {
    disclaimer: tAi("disclaimerLine"),
    refuseLeak: tAi("refuseLeak"),
    safe: {
      injury: tAi("safe.injury"),
      medical: tAi("safe.medical"),
      eatingDisorder: tAi("safe.eatingDisorder"),
      minorDiet: tAi("safe.minorDiet"),
    },
  };

  /** Writes the answer to `history` (which ends with the question) into conversation `id`, streamed from the hosted engine. */
  const answerFor = async (id: string, history: ChatMessage[]) => {
    const mine = generation.current;
    const current = (): boolean => mounted.current && generation.current === mine;
    const ctl = new AbortController();
    controller.current = ctl;
    stopped.current = null;
    sendingRef.current = true;
    setSending(true);
    setFailure(null);
    setToolsOff(false);
    liveRef.current = initialLive();
    // The finished answer takes the id of the live one, so the same element keeps its place when the text becomes the message.
    const replyId = joyoChats.newMessageId();
    liveId.current = replyId;
    setLive(liveRef.current);
    setAnnounce(t("chat.answering"));
    const commit = createCoalescer(
      () => {
        if (current()) setLive(liveRef.current);
      },
      COMMIT_MS,
      { now: Date.now, setTimer: (run, ms) => setTimeout(run, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    );
    const finish = (next: ChatMessage[]) => {
      setList(next);
      persist(id, next);
    };
    try {
      const input = hostedInput(history, { locale, today: jakartaToday(), consentVersion: CONSENT_VERSION });
      const events = await client.joyo.chat(input, { signal: ctl.signal });
      let result: HostedDone | null = null;
      for await (const event of events) {
        if (event.type === "done") {
          result = event.result;
          continue;
        }
        liveRef.current = reduceLive(liveRef.current, event);
        if (event.type === "text" || event.type === "reasoning") commit.schedule();
        else commit.flush();
      }
      if (!current()) return;
      commit.cancel();
      if (result === null) {
        // The stream ended without its closing event: nothing usable arrived.
        setFailure({ kind: "error", reason: "empty" });
        return;
      }
      const reply = assistantMessage({
        id: replyId,
        at: Date.now(),
        content: result.reply,
        engine: "hosted",
        steps: result.steps,
        reasoning: result.reasoning,
        fixed: result.fixed,
        tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
      });
      setToolsOff(result.toolsUnsupported);
      onUsage(result.usedToday, result.dailyCap);
      setAnnounce(t("chat.answered"));
      finish([...history, reply]);
    } catch (error) {
      if (!current()) return;
      const reason = classifyJoyoError(error, ctl.signal);
      if (reason.kind === "aborted") {
        // Stop: what arrived stays as the answer, marked stopped; with nothing arrived only the question stays. No error either way.
        const partial = stopped.current === "user" ? partialOnStop(liveRef.current) : null;
        if (partial) {
          const lastUserText = history.findLast((m) => m.role === "user")?.content ?? "";
          const cleaned = finishReply(partial.content, {
            text: safetyText,
            lastUserText,
            mode: { conservative: mentionsMaternal(lastUserText), minor: false },
            locale,
          });
          if (cleaned) {
            commit.cancel();
            finish([...history, assistantMessage({ id: replyId, at: Date.now(), engine: "hosted", ...partial, content: cleaned })]);
          }
        }
        return;
      }
      if (reason.kind === "paywall" || reason.kind === "minor" || reason.kind === "noConsent") {
        onRefused(reason);
        return;
      }
      setFailure(reason);
    } finally {
      commit.cancel();
      if (controller.current === ctl) controller.current = null;
      if (current()) {
        sendingRef.current = false;
        setSending(false);
        setLive(null);
      }
    }
  };

  /** Sends a question: a new one at the end, or (when editing) in place of an earlier one, dropping everything after it. */
  const submit = async (raw: string) => {
    const content = raw.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content || sendingRef.current || !loaded) return;
    sendingRef.current = true;
    const base = messagesRef.current;
    const editAt = editing ? base.findIndex((m) => m.id === editing.id) : -1;
    const kept = editAt >= 0 ? base.slice(0, editAt) : base;
    let id = idRef.current;
    if (!id) {
      try {
        id = (await joyoChats.create(content)).id;
      } catch {
        id = null;
      }
    }
    const question: ChatMessage = { id: joyoChats.newMessageId(), role: "user", content, at: Date.now() };
    const next = [...kept, question];
    // Without a saved chat (storage unreachable) the conversation still runs, in memory, under a throwaway id.
    const chatId = id ?? `local-${question.id}`;
    setChat(chatId, next);
    if (id) persist(id, next);
    setText("");
    setEditing(null);
    toBottom();
    void answerFor(chatId, next);
  };

  const stop = useStable(() => {
    stopped.current = "user";
    controller.current?.abort();
  });

  // Esc stops an answer from anywhere on the page (the composer handles its own), unless a dialog has the keyboard.
  useEffect(() => {
    if (!sending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending, stop]);

  const regenerate = useStable(() => {
    const id = idRef.current;
    const list = messagesRef.current;
    const last = list.length - 1;
    if (!id || sendingRef.current || last < 0 || list[last]!.role !== "assistant") return;
    const kept = list.slice(0, last);
    setList(kept);
    persist(id, kept);
    void answerFor(id, kept);
  });

  const retry = useStable(() => {
    const id = idRef.current;
    const list = messagesRef.current;
    if (!id || sendingRef.current || list.length === 0 || list[list.length - 1]!.role !== "user") return;
    void answerFor(id, list);
  });

  const edit = useStable((message: ChatMessage) => {
    if (sendingRef.current) return;
    setEditing(message);
    setText(message.content);
    setFocusTick((n) => n + 1);
  });

  const cancelEdit = () => {
    setEditing(null);
    setText("");
  };

  const copy = useStable(async (message: ChatMessage): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(message.content);
      return true;
    } catch {
      return false;
    }
  });

  const canFold = useCallback(() => !awayRef.current, [awayRef]);

  const removed = useCallback(
    (id: string) => {
      if (id === idRef.current) startNew();
    },
    [startNew],
  );

  const deleteAll = async () => {
    await joyoChats.clearAll().catch(() => undefined);
    setConfirmAll(false);
    startNew();
  };

  // Follow the end of the chat while the person is there: after each drawn update and when the question appears.
  useLayoutEffect(() => {
    if (sending && !awayRef.current) toBottom();
  }, [live, sending, toBottom, awayRef]);

  const lastUser = lastIndexOfRole(messages, "user");
  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  const flagged = !sending && lastMessage?.role === "assistant" && lastMessage.fixed === true;
  const empty = loaded && messages.length === 0 && !sending;

  const rows = useMemo(() => {
    const out: ReactNode[] = messages.map((message, i) =>
      message.role === "user" ? (
        <UserMessage
          key={message.id}
          message={message}
          canEdit={i === lastUser}
          canRetry={i === lastIndex && !sending}
          busy={sending}
          onEdit={edit}
          onRetry={retry}
        />
      ) : (
        <AssistantMessage
          key={message.id}
          message={message}
          live={null}
          locale={locale}
          canRegenerate={i === lastIndex}
          busy={sending}
          onCopy={copy}
          onRegenerate={regenerate}
          canFold={canFold}
        />
      ),
    );
    if (sending && live) {
      out.push(
        <AssistantMessage
          key={liveId.current}
          message={null}
          live={live}
          locale={locale}
          canRegenerate={false}
          busy
          onCopy={copy}
          onRegenerate={regenerate}
          canFold={canFold}
        />,
      );
    }
    return out;
  }, [messages, lastUser, lastIndex, sending, live, locale, edit, retry, copy, regenerate, canFold]);

  const failureText = failure ? failureKey(failure) : null;

  return (
    <div className="flex min-h-[calc(100svh-9rem)] flex-col">
      <header className="flex items-center justify-between gap-3 px-1 pt-1 pb-3">
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight">{t("title")}</h1>
          {usage && usage.cap > 0 ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("status.today", { used: usage.used, cap: usage.cap })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={t("chat.history")} title={t("chat.history")} onClick={() => setHistoryOpen(true)}>
            <History aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("chat.new")} title={t("chat.new")} onClick={startNew}>
            <SquarePen aria-hidden />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-5 pb-4">
        {empty ? (
          <section className="space-y-4 pt-4">
            <div className="space-y-1.5 px-1">
              <h2 className="text-base font-bold tracking-tight">{t("chat.emptyTitle")}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{t("chat.emptyBody")}</p>
              <p className="text-xs text-muted-foreground">{t("chat.storedHere")}</p>
            </div>
            <ul className="flex flex-col items-start gap-2">
              {SUGGESTIONS.map((key) => (
                <li key={key} className="max-w-full">
                  <button
                    type="button"
                    onClick={() => void submit(tAi(`suggestions.${key}`))}
                    className="pressable min-h-11 max-w-full rounded-3xl bg-muted px-4 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    {tAi(`suggestions.${key}`)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {rows}
        {flagged ? <Notice>{t("chat.flagged")}</Notice> : null}
        {toolsOff ? <Notice>{t("chat.toolsOff")}</Notice> : null}
        {failure && failureText ? (
          <Notice tone="danger" onClose={() => setFailure(null)} closeLabel={t("chat.dismiss")}>
            {tAi(failureText as never)}
          </Notice>
        ) : null}
        {failure?.kind === "unavailable" ? (
          <Notice tone="danger" onClose={() => setFailure(null)} closeLabel={t("chat.dismiss")}>
            {t("gate.unavailable.body")}
          </Notice>
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {announce}
      </p>

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-background px-4 pt-2 pb-3 md:bottom-0 md:pb-4">
        {away ? (
          <Button
            variant="outline"
            size="sm"
            className="absolute -top-12 left-1/2 -translate-x-1/2 shadow-float"
            onClick={() => toBottom(true)}
          >
            <ArrowDown aria-hidden />
            {t("chat.jump")}
          </Button>
        ) : null}
        <Composer
          text={text}
          onChange={setText}
          onSend={() => void submit(text)}
          onStop={stop}
          sending={sending}
          editing={editing !== null}
          onCancelEdit={cancelEdit}
          maxLength={MAX_MESSAGE_CHARS}
          inputRef={inputRef}
        />
      </div>

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        store={joyoChats}
        currentId={conversationId}
        onOpen={openSaved}
        onRemoved={removed}
        onDeleteAll={() => {
          setHistoryOpen(false);
          setConfirmAll(true);
        }}
      />
      <ConfirmSheet
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t("history.deleteAllTitle")}
        body={t("history.deleteAllBody")}
        confirmLabel={t("history.deleteAllConfirm")}
        pending={false}
        onConfirm={() => void deleteAll()}
      />
    </div>
  );
}
