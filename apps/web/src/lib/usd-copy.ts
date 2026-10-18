import type { ParseKeys, TOptions } from "i18next";
import { useTranslation } from "react-i18next";

/** `billing` translator pinned to English: the USD flow stays English in any UI language. */
export function useEnglishBilling() {
  const { t } = useTranslation("billing");
  return (key: ParseKeys<"billing">, options?: TOptions): string =>
    t(key, { ...options, lng: "en" }) as string;
}
