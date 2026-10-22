import { cn } from "@joyorogo/ui/lib/utils";
import { CircleAlert, ChevronDown, Lightbulb, ListChecks } from "lucide-react";
import { memo, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { stepCall, stepLabel, stepState } from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { StepView, Translate } from "@joyorogo/api/lib/joyo-ai/chat-state";

const ROW =
  "flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      aria-hidden
      className={cn(
        "size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
        open && "rotate-180",
      )}
    />
  );
}

/** `t` of the shared `joyoAi` namespace as the pure step wording wants it. */
export function useAiTranslate(): Translate {
  const { t } = useTranslation("joyoAi");
  return (key, options) => String(t(key as never, options as never));
}

function StepRow({ step, tAi }: { step: StepView; tAi: Translate }) {
  const { t } = useTranslation("joyoAiWeb");
  const [open, setOpen] = useState(false);
  const panel = useId();
  const state = stepState(step);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className={cn(ROW, "text-muted-foreground hover:text-foreground")}
      >
        {state === "failed" ? (
          <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
        ) : null}
        <span className="min-w-0 flex-1 break-words">{stepLabel(step, tAi)}</span>
        {state === "failed" ? (
          <span className="shrink-0 text-xs font-semibold text-destructive">{t("steps.failed")}</span>
        ) : null}
        <Chevron open={open} />
      </button>
      {open ? (
        <div id={panel} className="px-2 pb-2">
          <p className="text-xs text-muted-foreground">{t("steps.call")}</p>
          <p className="font-mono text-xs break-all text-muted-foreground select-text">{stepCall(step)}</p>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The tools an answer ran, in one card above the answer text, headed by how many were read. Open while the answer is being
 * written; it folds when the answer ends, unless the person has scrolled away (then nothing moves under their eyes).
 * Each row opens to the exact call (tool and plain arguments, never a value read).
 */
export const StepsCard = memo(function StepsCard({
  steps,
  live,
  canFold,
}: {
  steps: readonly StepView[];
  live: boolean;
  /** Asked once when a live answer ends: true when folding the card cannot move what the person is reading. */
  canFold: () => boolean;
}) {
  const { t } = useTranslation("joyoAiWeb");
  const tAi = useAiTranslate();
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  const body = useId();
  useEffect(() => {
    if (wasLive.current && !live && canFold()) setOpen(false);
    wasLive.current = live;
  }, [live, canFold]);
  if (steps.length === 0) return null;
  const title = t("steps.group", { count: steps.length });
  return (
    <div className="rounded-2xl bg-muted px-2 py-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={body}
        onClick={() => setOpen((v) => !v)}
        className={cn(ROW, "font-semibold text-muted-foreground")}
      >
        <ListChecks aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">{title}</span>
        <Chevron open={open} />
      </button>
      {open ? (
        <ul id={body} className="pb-1">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} tAi={tAi} />
          ))}
        </ul>
      ) : null}
    </div>
  );
});

/** The model's reasoning: one muted row, closed until pressed. While the answer is being written it reads "Berpikir". */
export const ReasoningBlock = memo(function ReasoningBlock({ text, live }: { text: string; live?: boolean }) {
  const { t } = useTranslation("joyoAiWeb");
  const [open, setOpen] = useState(false);
  const panel = useId();
  const body = text.trim();
  if (body === "") return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className={cn(ROW, "w-auto text-muted-foreground hover:text-foreground")}
      >
        <Lightbulb aria-hidden className="size-4 shrink-0" />
        <span>{live ? t("chat.thinking") : t("chat.thought")}</span>
        <Chevron open={open} />
      </button>
      {open ? (
        <p id={panel} className="px-2 pb-1 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {body}
        </p>
      ) : null}
    </div>
  );
});
