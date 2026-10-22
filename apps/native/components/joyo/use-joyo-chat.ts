// Ported from JoyoFit (watch-fit) src/features/ai/ui/JoyoAiChat.tsx (the logic), adapted for JoyoRogo.
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextInput } from "react-native";

import {
  createCoalescer,
  assistantMessage,
  initialLive,
  partialOnStop,
  reduceLive,
  type LiveState,
} from "@joyorogo/api/lib/joyo-ai/chat-state";
import { chatLines, type ChatMessage } from "@joyorogo/api/lib/joyo-ai/conversations";
import { hostedConsentOk } from "@joyorogo/api/lib/joyo-ai/consent";
import {
  finishReply,
  mentionsMaternal,
  personMode,
  SAFETY_LIMITS,
  type SafetyText,
} from "@joyorogo/api/lib/joyo-ai/safety";
import { AiError, type ProviderId } from "@joyorogo/api/lib/joyo-ai/types";
import { isLocale, type Locale } from "@joyorogo/i18n";

import { useToast } from "@/components/toast";
import { isPaywallError } from "@/utils/orpc";

import { askHosted, askOwnKey, grantHostedConsentNow } from "@/src/lib/joyo-ai/engine";
import {
  hostedFailure,
  viewAiError,
  type AiErrorView,
  type HostedFailure,
} from "@/src/lib/joyo-ai/error-view";
import { chatGate, type ChatGate } from "@/src/lib/joyo-ai/gate";
import { ownStateOf, useJoyoState } from "@/src/lib/joyo-ai/hooks";
import { UNKNOWN_PERSON } from "@/src/lib/joyo-ai/person";
import { joyoChats, joyoSettings, joyoUsage } from "@/src/lib/joyo-ai/stores";

import { useChatScroll } from "./use-chat-scroll";

/** How often the growing text is shown: a fast stream is read into a ref at full speed and committed at most this often. */
const COMMIT_MS = 50;

/** A callback with a stable identity that always calls the latest closure (so memoised messages are not re-rendered by every token). */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** What the last question left to say under the conversation. */
export type ChatNotice =
  | { kind: "own"; view: AiErrorView }
  | { kind: "hosted"; failure: HostedFailure }
  | { kind: "paywall" };

export interface JoyoChat {
  gate: ChatGate;
  /** The own-key engine in use (provider and model for the chip), when it is the one answering. */
  own: { provider: ProviderId; model: string; baseUrl: string } | null;
  /** An own key is set up and usable (whichever engine is chosen): the gate cards offer switching to it. */
  ownUsable: boolean;
  messages: ChatMessage[];
  /** The conversation is being read from its file. */
  opening: boolean;
  conversationId: string | null;
  title: string;
  text: string;
  setText: (text: string) => void;
  editing: ChatMessage | null;
  sending: boolean;
  live: LiveState | null;
  /** The id the finished answer will take: the list keeps one cell when the live text becomes the message. */
  liveId: string;
  notice: ChatNotice | null;
  toolsOff: boolean;
  /** Tokens and calls today with the own key (null for the hosted engine). */
  usage: { tokens: number; calls: number; ceiling: number } | null;
  /** Hosted questions used today, once known. */
  hostedUsage: { used: number; cap: number } | null;
  locale: Locale;
  scroll: ReturnType<typeof useChatScroll>;
  inputRef: React.RefObject<TextInput | null>;
  focusTick: number;
  submit: (raw: string) => void;
  stop: () => void;
  regenerate: () => void;
  retry: () => void;
  edit: (message: ChatMessage) => void;
  cancelEdit: () => void;
  copy: (message: ChatMessage) => void;
  startNew: () => void;
  rename: (title: string) => void;
  agreeHosted: () => Promise<void>;
}

/**
 * The chat of Joyo AI, both engines: the own key (the phone calls the provider, streamed, with the data it read shown as steps) and
 * JoyoRogo's hosted engine (Pro, streamed from the server). They write the same conversations. `ask` is a question to type into a new
 * chat, unsent (the "Tanya Joyo AI" shortcuts); `onAskApplied` clears it from the route once it was used.
 */
export function useJoyoChat({
  ask,
  onAskApplied,
}: {
  ask: string | undefined;
  onAskApplied: () => void;
}): JoyoChat {
  const { t } = useTranslation("joyoAiApp");
  const { t: tj, i18n } = useTranslation("joyoAi");
  const toast = useToast();
  const locale: Locale = isLocale(i18n.language) ? i18n.language : "id";
  const state = useJoyoState();
  const { settings, access, hosted, person, loaded } = state;
  const scroll = useChatScroll();
  const follow = scroll.follow;
  const inputRef = useRef<TextInput>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [opening, setOpening] = useState(true);
  const idRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  const [text, setText] = useState("");
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const liveRef = useRef<LiveState>(initialLive());
  const [liveId, setLiveId] = useState("live");
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  const [toolsOff, setToolsOff] = useState(false);
  const [usage, setUsage] = useState<JoyoChat["usage"]>(null);
  const [hostedUsage, setHostedUsage] = useState<{ used: number; cap: number } | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const gate = chatGate({
    engine: settings.engine,
    loaded,
    own: loaded ? ownStateOf(access) : null,
    hosted: hosted.state,
    hostedConsent: hostedConsentOk(settings),
  });
  const ownReady =
    gate.kind === "ready" && gate.engine === "byok" && access?.ok === true ? access : null;
  const ready = gate.kind === "ready";

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  // Why the request was aborted: "user" keeps what arrived; "switch" (another chat opened) and a closed screen end quietly.
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

  const setChat = useCallback((id: string | null, next: ChatMessage[], nextTitle: string) => {
    idRef.current = id;
    messagesRef.current = next;
    setConversationId(id);
    setMessages(next);
    setTitle(nextTitle);
  }, []);
  const setList = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  /** Shows a saved conversation, or an empty new one for null. A running answer is dropped quietly. */
  const open = useCallback(
    async (id: string | null) => {
      generation.current += 1;
      const mine = generation.current;
      stopped.current = "switch";
      controller.current?.abort();
      sendingRef.current = false;
      setSending(false);
      setLive(null);
      setText("");
      setEditing(null);
      setNotice(null);
      setToolsOff(false);
      const conversation = id ? await joyoChats.get(id) : null;
      if (!mounted.current || generation.current !== mine) return;
      setChat(
        conversation ? conversation.id : null,
        conversation?.messages ?? [],
        conversation?.title ?? "",
      );
      setOpening(false);
      follow();
    },
    [setChat, follow],
  );

  // Coming back from the history: show the chat the store says is open. An unsent shortcut question starts a new one instead.
  const appliedAsk = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (ask) return;
        const current = await joyoChats.current();
        if (cancelled || !mounted.current) return;
        if (current !== idRef.current || opening) await open(current);
      })();
      return () => {
        cancelled = true;
      };
    }, [ask, open, opening]),
  );

  // A shortcut ("Tanya Joyo AI" on a food) opens a NEW chat with the question typed in, once per navigation; the person sends it.
  useEffect(() => {
    if (!ask) {
      appliedAsk.current = null;
      return;
    }
    if (appliedAsk.current === ask) return;
    appliedAsk.current = ask;
    void (async () => {
      await joyoChats.setCurrent(null);
      await open(null);
      if (!mounted.current) return;
      setText(ask.slice(0, SAFETY_LIMITS.maxMessageChars));
      setFocusTick((n) => n + 1);
      onAskApplied();
    })();
  }, [ask, open, onAskApplied]);

  useEffect(() => {
    if (focusTick === 0 || !ready) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [focusTick, ready]);

  // The own key's count of today, read once the chat can use it and after every answer.
  const refreshUsage = useCallback(async () => {
    const today = await joyoUsage.today();
    if (mounted.current)
      setUsage({
        tokens: today.inputTokens + today.outputTokens,
        calls: today.calls,
        ceiling: joyoSettings.getSnapshot().settings.dailyCeiling,
      });
  }, []);
  useEffect(() => {
    if (ownReady) void refreshUsage();
  }, [ownReady, refreshUsage]);

  // Back near the newest message during an answer: draw what has arrived meanwhile.
  const { onBack } = scroll;
  useEffect(() => {
    onBack(() => {
      if (sendingRef.current) setLive(liveRef.current);
    });
  }, [onBack]);

  const safetyText: SafetyText = {
    disclaimer: tj("disclaimerLine"),
    refuseLeak: tj("refuseLeak"),
    safe: {
      injury: tj("safe.injury"),
      medical: tj("safe.medical"),
      eatingDisorder: tj("safe.eatingDisorder"),
      minorDiet: tj("safe.minorDiet"),
    },
  };

  /** Writes the answer to `history` (which ends with the question) into conversation `id`, streamed on both engines. */
  const answerFor = async (id: string, history: ChatMessage[], engine: "hosted" | "byok") => {
    const mine = generation.current;
    const current = (): boolean => mounted.current && generation.current === mine;
    const ctl = new AbortController();
    controller.current = ctl;
    stopped.current = null;
    sendingRef.current = true;
    setSending(true);
    setNotice(null);
    setToolsOff(false);
    liveRef.current = initialLive();
    // The finished answer takes the id of the live one, so the list keeps the same cell when the live text becomes the message.
    const replyId = joyoChats.newMessageId();
    setLiveId(replyId);
    setLive(liveRef.current);
    const commit = createCoalescer(
      () => {
        // Away from the newest message the answer is not drawn (nothing under the person's eyes changes); it is drawn again when they come back.
        if (current() && !scroll.awayRef.current) setLive(liveRef.current);
      },
      COMMIT_MS,
      {
        now: Date.now,
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (h) => clearTimeout(h as never),
      },
    );
    const onEvent = (event: Parameters<typeof reduceLive>[1]) => {
      liveRef.current = reduceLive(liveRef.current, event);
      if (event.type === "text" || event.type === "reasoning") commit.schedule();
      else commit.flush();
    };
    const finish = async (messagesNow: ChatMessage[]) => {
      scroll.expectGrowth();
      setList(messagesNow);
      const saved = await joyoChats.setMessages(id, messagesNow);
      if (saved && current()) setTitle(saved.title);
    };
    const lastUserText = history.findLast((m) => m.role === "user")?.content ?? "";
    const who = person ?? UNKNOWN_PERSON;
    try {
      let reply: ChatMessage;
      if (engine === "byok") {
        const { answer, provider, model } = await askOwnKey({
          history: chatLines(history),
          person: who,
          locale,
          text: safetyText,
          signal: ctl.signal,
          onEvent,
        });
        if (!current()) return;
        reply = assistantMessage({
          id: replyId,
          at: Date.now(),
          content: answer.reply,
          engine: "byok",
          ...(answer.fixed ? {} : { provider, model }),
          steps: answer.fixed ? [] : answer.steps,
          reasoning: answer.fixed ? "" : answer.reasoning,
          fixed: answer.fixed,
          tokens: { input: answer.usage.inputTokens, output: answer.usage.outputTokens },
        });
        setToolsOff(answer.toolsUnsupported);
      } else {
        const done = await askHosted({
          history: chatLines(history),
          locale,
          signal: ctl.signal,
          onEvent,
        });
        if (!current()) return;
        reply = assistantMessage({
          id: replyId,
          at: Date.now(),
          content: done.reply,
          engine: "hosted",
          steps: done.fixed ? [] : done.steps,
          reasoning: done.fixed ? "" : done.reasoning,
          fixed: done.fixed,
        });
        setToolsOff(done.toolsUnsupported);
        setHostedUsage({ used: done.usedToday, cap: done.dailyCap });
      }
      commit.cancel();
      await finish([...history, reply]);
    } catch (e) {
      if (!current()) return;
      if (ctl.signal.aborted || (e instanceof AiError && e.kind === "aborted")) {
        // Stop: what arrived stays as the answer, marked stopped; with nothing arrived only the question stays. No error either way.
        const rawPartial = stopped.current === "user" ? partialOnStop(liveRef.current) : null;
        // The same cleaning and disclaimer rule as a finished answer, so a stopped answer about pain or medication still carries the line.
        const cleaned = rawPartial
          ? finishReply(rawPartial.content, {
              text: safetyText,
              lastUserText,
              mode: personMode(who, mentionsMaternal(lastUserText)),
              locale,
            })
          : null;
        if (rawPartial && cleaned) {
          commit.cancel();
          await finish([
            ...history,
            assistantMessage({
              id: replyId,
              at: Date.now(),
              engine,
              ...(ownReady ? { provider: ownReady.provider, model: ownReady.model } : {}),
              ...rawPartial,
              content: cleaned,
            }),
          ]);
        }
        return;
      }
      if (engine === "byok") {
        setNotice({
          kind: "own",
          view: viewAiError(e, {
            provider: ownReady?.provider ?? null,
            ceiling: settings.dailyCeiling,
          }),
        });
      } else if (isPaywallError(e)) {
        setNotice({ kind: "paywall" });
      } else {
        setNotice({ kind: "hosted", failure: hostedFailure(e) });
      }
    } finally {
      commit.cancel();
      if (controller.current === ctl) controller.current = null;
      if (current()) {
        sendingRef.current = false;
        setSending(false);
        setLive(null);
        if (engine === "byok") void refreshUsage();
      }
    }
  };
  const engineNow = (): "hosted" | "byok" | null => (gate.kind === "ready" ? gate.engine : null);

  /** Sends a question: a new one at the end, or (when editing) in place of an earlier one, dropping everything after it. */
  const submit = (raw: string) => {
    const content = raw.trim().slice(0, SAFETY_LIMITS.maxMessageChars);
    const engine = engineNow();
    if (!content || sendingRef.current || engine === null) return;
    void (async () => {
      let id = idRef.current;
      let kept = messagesRef.current;
      if (editing && id) kept = await joyoChats.truncateFrom(id, editing.id);
      if (!id) id = (await joyoChats.create(content)).id;
      const question: ChatMessage = {
        id: joyoChats.newMessageId(),
        role: "user",
        content,
        at: Date.now(),
      };
      const next = [...kept, question];
      setChat(id, next, title);
      setText("");
      setEditing(null);
      follow();
      void joyoChats
        .setMessages(id, next)
        .then((saved) => saved && mounted.current && setTitle(saved.title));
      void answerFor(id, next, engine);
    })();
  };

  const stop = () => {
    stopped.current = "user";
    controller.current?.abort();
  };

  const regenerate = useStable(() => {
    const id = idRef.current;
    const list = messagesRef.current;
    const last = list.length - 1;
    const engine = engineNow();
    if (
      !id ||
      engine === null ||
      sendingRef.current ||
      last < 0 ||
      list[last]!.role !== "assistant"
    )
      return;
    void joyoChats.truncateFrom(id, list[last]!.id).then((kept) => {
      setList(kept);
      void answerFor(id, kept, engine);
    });
  });

  const retry = useStable(() => {
    const id = idRef.current;
    const list = messagesRef.current;
    const engine = engineNow();
    if (
      !id ||
      engine === null ||
      sendingRef.current ||
      list.length === 0 ||
      list[list.length - 1]!.role !== "user"
    )
      return;
    void answerFor(id, list, engine);
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

  const copy = useStable((message: ChatMessage) => {
    void Clipboard.setStringAsync(message.content).then(() => toast.info(t("chat.copied")));
  });

  const startNew = () => {
    void joyoChats.setCurrent(null).then(() => open(null));
  };

  const rename = (next: string) => {
    const id = idRef.current;
    if (!id) return;
    void joyoChats.rename(id, next).then(async () => {
      const meta = (await joyoChats.list()).find((m) => m.id === id);
      if (meta && mounted.current) setTitle(meta.title);
    });
  };

  const agreeHosted = async () => {
    await grantHostedConsentNow();
  };

  return {
    gate,
    own: ownReady
      ? { provider: ownReady.provider, model: ownReady.model, baseUrl: ownReady.baseUrl }
      : null,
    ownUsable: access?.ok === true,
    messages,
    opening,
    conversationId,
    title,
    text,
    setText,
    editing,
    sending,
    live,
    liveId,
    notice,
    toolsOff,
    usage,
    hostedUsage:
      hostedUsage ??
      (hosted.used !== null && hosted.cap !== null ? { used: hosted.used, cap: hosted.cap } : null),
    locale,
    scroll,
    inputRef,
    focusTick,
    submit,
    stop,
    regenerate,
    retry,
    edit,
    cancelEdit,
    copy,
    startNew,
    rename,
    agreeHosted,
  };
}
