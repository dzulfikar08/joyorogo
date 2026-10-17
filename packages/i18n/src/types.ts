import type { DEFAULT_NAMESPACE, Resources } from "./resources";

// Typed keys: `t("makan:summary.title")` or `useTranslation("makan")` + `t("summary.title")`
// fail tsc when the key is not in locales/id/*.json.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: Resources;
    returnNull: false;
  }
}
