import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { Translate } from "@joyorogo/api/lib/joyo-ai/chat-state";

/** `t` of the shared `joyoAi` namespace in the loose shape Core's pure helpers take. */
export function useJoyoAiT(): Translate {
  const { t } = useTranslation("joyoAi");
  return useCallback(
    (key, options) =>
      (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, options),
    [t],
  );
}

/** `t` that takes any `ns:key` of Joyo AI's two namespaces (keys that come from data, like an error's message reference). */
export function useLooseT(): (key: string, options?: Record<string, unknown>) => string {
  const { t } = useTranslation(["joyoAiApp", "joyoAi"]);
  return useCallback(
    (key, options) =>
      (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, options),
    [t],
  );
}
