import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Copy, Crown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, Segmented } from "@/components/kit";
import { PRICING_URL } from "@/components/pro-wall";
import { copyText } from "@/lib/clipboard";
import { orpc } from "@/lib/orpc";

import { Steps } from "./shared";

/** The AI-app guide on the JoyoRogo website (docs/mcp-connector.md names it as the user-facing steps). */
export const GUIDE_URL = "https://joyorogo.com/panduan/ai";

const CLAUDE_STEPS = ["claude1", "claude2", "claude3", "claude4", "claude5", "claude6"] as const;
const CHATGPT_STEPS = [
  "chatgpt1",
  "chatgpt2",
  "chatgpt3",
  "chatgpt4",
  "chatgpt5",
  "chatgpt6",
] as const;

type App = "claude" | "chatgpt";

/** The connector address with a copy button, and the steps to add it in Claude or ChatGPT. */
export function ConnectorCard() {
  const { t } = useTranslation("fitWebConnect");
  const info = useQuery(orpc.mcpConnection.info.queryOptions());
  const [app, setApp] = useState<App>("claude");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async (url: string) => {
    setCopy((await copyText(url)) ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopy("idle"), 3000);
  };

  return (
    <Card className="flex flex-col gap-5">
      {info.data && !info.data.unlocked && (
        <div className="flex gap-3 rounded-2xl bg-warning/10 p-3.5 text-sm text-foreground">
          <Crown className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0">
            <p className="leading-relaxed">{t("mcp.pro.required")}</p>
            <a
              href={PRICING_URL}
              className="mt-1 inline-flex min-h-9 items-center font-semibold text-primary underline underline-offset-4"
            >
              {t("mcp.pro.cta")}
            </a>
          </div>
        </div>
      )}

      <div>
        <CardHeader title={t("mcp.connector.title")} subtitle={t("mcp.connector.hint")} />
        {info.isPending ? (
          <Skeleton className="h-14 w-full rounded-2xl" />
        ) : info.data ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-muted p-3 sm:flex-row sm:items-center">
            <code
              aria-label={t("mcp.connector.label")}
              className="min-w-0 flex-1 text-sm break-all select-all"
            >
              {info.data.url}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => void onCopy(info.data.url)}
            >
              {copy === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copy === "copied" ? t("mcp.connector.copied") : t("mcp.connector.copy")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted p-3 text-sm">
            <p className="min-w-0 flex-1 text-destructive">{t("mcp.connector.error")}</p>
            <Button variant="outline" size="sm" onClick={() => void info.refetch()}>
              {t("mcp.connector.retry")}
            </Button>
          </div>
        )}
        <p
          role="status"
          aria-live="polite"
          className="mt-1.5 min-h-4 text-xs text-muted-foreground"
        >
          {copy === "copied"
            ? t("mcp.connector.copied")
            : copy === "failed"
              ? t("mcp.connector.copyFailed")
              : ""}
        </p>
      </div>

      <div>
        <Segmented<App>
          label={t("mcp.steps.choose")}
          value={app}
          onChange={setApp}
          options={[
            { value: "claude", label: t("mcp.steps.claude") },
            { value: "chatgpt", label: t("mcp.steps.chatgpt") },
          ]}
        />
        <div className="mt-4 flex flex-col gap-3">
          <h3 className="text-sm font-bold">
            {app === "claude" ? t("mcp.steps.claudeTitle") : t("mcp.steps.chatgptTitle")}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {app === "claude" ? t("mcp.steps.claudeIntro") : t("mcp.steps.chatgptIntro")}
          </p>
          <Steps
            items={
              app === "claude"
                ? CLAUDE_STEPS.map((key) => t(`mcp.steps.${key}`))
                : CHATGPT_STEPS.map((key) => t(`mcp.steps.${key}`))
            }
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {app === "claude" ? t("mcp.steps.claudeNote") : t("mcp.steps.chatgptNote")}
          </p>
        </div>
      </div>

      <a
        href={GUIDE_URL}
        className="inline-flex min-h-10 items-center gap-2 self-start text-sm font-semibold text-primary underline-offset-4 hover:underline"
      >
        <BookOpen className="size-4 shrink-0" aria-hidden />
        {t("mcp.steps.guide")}
      </a>
    </Card>
  );
}
