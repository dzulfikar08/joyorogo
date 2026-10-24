import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CorrectInput, CorrectOutcome } from "./correct-box";

/** Server messages are already localized; the transcript survives a failed parse. */
function errorTranscript(err: unknown): string | null {
  const data = (err as { data?: { transcript?: unknown } } | null)?.data;
  return typeof data?.transcript === "string" && data.transcript ? data.transcript : null;
}

/**
 * One correction request and what to say about it: the shared state of the correction box and the simple screen's mic.
 * `onSubmit` resolves null when the answer is stale and must be ignored.
 */
export function useCorrectionRun(onSubmit: (input: CorrectInput) => Promise<CorrectOutcome | null>) {
  const { t } = useTranslation("scan");
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CorrectOutcome | null>(null);
  const [undone, setUndone] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);

  /** Resolves the outcome, or null when it failed or went stale. */
  const run = async (input: CorrectInput): Promise<CorrectOutcome | null> => {
    setError(null);
    setHeard(null);
    setOutcome(null);
    setUndone(false);
    setProcessing(true);
    try {
      const result = await onSubmit(input);
      if (!result) return null;
      setOutcome(result);
      setHeard(result.transcript);
      if (result.correctionsLeft !== null) setLeft(result.correctionsLeft);
      return result;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("correct.error.failed"));
      setHeard(errorTranscript(err));
      return null;
    } finally {
      setProcessing(false);
    }
  };

  /** After the screen undid the last correction. */
  const markUndone = () => {
    setOutcome(null);
    setHeard(null);
    setError(null);
    setUndone(true);
  };

  /** A new take started (null) or the recorder failed (a message). */
  const setVoiceError = (message: string | null) => {
    setError(message);
    if (message === null) setHeard(null);
  };

  return { error, heard, outcome, undone, left, processing, run, markUndone, setVoiceError };
}
