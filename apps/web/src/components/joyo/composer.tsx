import { Button } from "@joyorogo/ui/components/button";
import { ArrowUp, Square, X } from "lucide-react";
import { useId, useLayoutEffect } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";

/** The box grows to about six lines and then scrolls. */
const MAX_FIELD_PX = 168;

export interface ComposerProps {
  text: string;
  onChange: (text: string) => void;
  onSend: () => void;
  /** Stops the answer being written; shown in place of send while `sending`. */
  onStop: () => void;
  sending: boolean;
  /** The person is rewriting an earlier question: a bar says so and can cancel. */
  editing: boolean;
  onCancelEdit: () => void;
  maxLength: number;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The composer: the editing bar, the multiline box with send (Stop while answering), and the standing line under it.
 * Enter sends, Shift+Enter starts a new line, Esc stops an answer being written. Enter never sends while an input method
 * (IME) is composing, so choosing a candidate does not send half a word.
 */
export function Composer({ text, onChange, onSend, onStop, sending, editing, onCancelEdit, maxLength, inputRef }: ComposerProps) {
  const { t } = useTranslation("joyoAiWeb");
  const { t: tAi } = useTranslation("joyoAi");
  const hint = useId();

  // Grows with the text without `field-sizing` (not in every browser).
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD_PX)}px`;
  }, [text, inputRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && sending) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!sending && text.trim() !== "") onSend();
  };

  return (
    <div className="space-y-2">
      {editing ? (
        <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1">{t("chat.editing")}</span>
          <button
            type="button"
            aria-label={t("chat.editCancel")}
            onClick={onCancelEdit}
            className="pressable inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none md:size-9"
          >
            <X aria-hidden className="size-[1.125rem]" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          maxLength={maxLength}
          enterKeyHint="send"
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.composerLabel")}
          aria-describedby={hint}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-42 min-h-12 min-w-0 flex-1 resize-none rounded-3xl bg-muted px-4 py-3 text-base leading-snug outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 md:text-[0.9375rem]"
        />
        {sending ? (
          <Button variant="secondary" size="icon-lg" aria-label={t("chat.stop")} title={`${t("chat.stop")} (Esc)`} onClick={onStop}>
            <Square aria-hidden className="fill-current" />
          </Button>
        ) : (
          <Button size="icon-lg" aria-label={t("chat.send")} disabled={text.trim() === ""} onClick={onSend}>
            <ArrowUp aria-hidden />
          </Button>
        )}
      </div>
      <p id={hint} className="px-1 text-center text-xs leading-snug text-muted-foreground">
        {tAi("disclaimerLine")}
        <span className="hidden md:inline"> {t("chat.shortcuts")}</span>
      </p>
    </div>
  );
}
