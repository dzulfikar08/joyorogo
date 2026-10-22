import { Check, Copy, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { liveStatus, splitStable, stepLabel } from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { LiveState, StepView } from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { ChatMessage } from "@joyorogo/api/lib/joyo-ai/conversations";
import { formatDurations } from "@joyorogo/api/lib/joyo-ai/durations";
import type { Locale } from "@joyorogo/i18n";

import { JoyoMarkdown } from "./markdown";
import { ReasoningBlock, StepsCard, useAiTranslate } from "./steps";

/** A quiet icon action: muted, always visible, a 44px target on touch and 36px with a pointer. */
export function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="pressable inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 md:size-9 [&_svg]:size-[1.125rem]"
    >
      {children}
    </button>
  );
}

export interface UserMessageProps {
  message: ChatMessage;
  /** The last question: it can be edited. */
  canEdit: boolean;
  /** A question with no answer after it (stopped or failed): it can be sent again. */
  canRetry: boolean;
  /** An answer is being written: actions that would start another one rest. */
  busy: boolean;
  onEdit: (message: ChatMessage) => void;
  onRetry: () => void;
}

export const UserMessage = memo(function UserMessage({ message, canEdit, canRetry, busy, onEdit, onRetry }: UserMessageProps) {
  const { t } = useTranslation("joyoAiWeb");
  return (
    <div className="flex flex-col items-end">
      <p className="sr-only">{t("chat.you")}</p>
      <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap">
        {message.content}
      </div>
      {canEdit || canRetry ? (
        <div className="-mr-2 flex">
          {canRetry ? (
            <ActionButton label={t("chat.retry")} disabled={busy} onClick={onRetry}>
              <RotateCcw aria-hidden />
            </ActionButton>
          ) : null}
          {canEdit ? (
            <ActionButton label={t("chat.edit")} disabled={busy} onClick={() => onEdit(message)}>
              <Pencil aria-hidden />
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export interface AssistantMessageProps {
  /** The finished (or stopped) message; null while the answer is still being written. */
  message: ChatMessage | null;
  /** What has arrived of the answer being written; null once it is a message. */
  live: LiveState | null;
  locale: Locale;
  canRegenerate: boolean;
  busy: boolean;
  onCopy: (message: ChatMessage) => Promise<boolean>;
  onRegenerate: () => void;
  /** True when folding the tools card at the end of an answer cannot move what the person is reading. */
  canFold: () => boolean;
}

/**
 * One answer, as flowing text across the width: the steps card, the markdown (settled paragraphs drawn once, the paragraph being
 * written drawn on each update), the reasoning (closed), and the actions. The writing and the finished answer are the same
 * element, so nothing is rebuilt (and nothing jumps) when the last token arrives.
 */
export const AssistantMessage = memo(function AssistantMessage({
  message,
  live,
  locale,
  canRegenerate,
  busy,
  onCopy,
  onRegenerate,
  canFold,
}: AssistantMessageProps) {
  const { t } = useTranslation("joyoAiWeb");
  const tAi = useAiTranslate();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const stored = message?.steps;
  const steps = useMemo<StepView[]>(
    () => (live ? live.steps : (stored ?? []).map((s) => ({ ...s, running: false }))),
    [live, stored],
  );
  const text = live ? live.text : (message?.content ?? "");
  const reasoning = live ? live.reasoning : (message?.reasoning ?? "");
  const shown = useMemo(() => (live ? formatDurations(text, locale) : text), [live, text, locale]);
  const { head, tail } = useMemo(() => (live ? splitStable(shown) : { head: "", tail: shown }), [live, shown]);

  let status: string | null = null;
  if (live && text === "") {
    const s = liveStatus(live);
    status = s.kind === "tool" ? stepLabel(s.step, tAi) : s.kind === "reasoning" ? t("chat.thinking") : t("chat.writing");
  }

  const copy = async () => {
    if (!message || !(await onCopy(message))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="space-y-2">
      <p className="sr-only">{t("title")}</p>
      <StepsCard steps={steps} live={live !== null} canFold={canFold} />
      {head === "" ? null : <JoyoMarkdown text={head} />}
      {tail === "" ? null : <JoyoMarkdown text={tail} streaming={live !== null} />}
      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}
      <ReasoningBlock text={reasoning} live={live !== null} />
      {message ? (
        <div className="flex items-center gap-2">
          <div className="-ml-2 flex">
            <ActionButton label={copied ? t("chat.copied") : t("chat.copy")} onClick={() => void copy()}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </ActionButton>
            {canRegenerate ? (
              <ActionButton label={t("chat.regenerate")} disabled={busy} onClick={onRegenerate}>
                <RefreshCw aria-hidden />
              </ActionButton>
            ) : null}
          </div>
          {message.stopped ? <span className="text-xs text-muted-foreground">{t("chat.stopped")}</span> : null}
          <span className="sr-only" role="status">
            {copied ? t("chat.copied") : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
});
