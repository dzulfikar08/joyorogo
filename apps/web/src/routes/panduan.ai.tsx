import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@joyorogo/ui/components/button";

import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/panduan/ai")({
  component: PanduanAiPage,
  head: () => pageHead("/panduan/ai"),
});

const CONNECTOR_URL = "https://api.joyorogo.com/mcp";

const CLAUDE_STEPS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;
const CHATGPT_STEPS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;
const QUESTIONS = ["q1", "q2", "q3", "q4", "q5"] as const;
const TOOLS = [
  "get_profile",
  "get_food_log",
  "get_daily_totals",
  "get_weight_history",
  "list_workouts",
  "get_workout",
  "get_recovery_metrics",
] as const;
const LIMITS = ["l1", "l2", "l3", "l4", "l5", "l6"] as const;
const TROUBLE = ["loop", "clientId", "pro", "reconnect", "scope"] as const;
const PRIVACY = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] as const;

const SECTIONS = [
  "what",
  "need",
  "claude",
  "chatgpt",
  "try",
  "tools",
  "limits",
  "trouble",
  "privacy",
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-3xl bg-card p-5">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-3 space-y-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-sm leading-relaxed">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5 text-sm leading-relaxed">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PanduanAiPage() {
  const { t } = useTranslation("panduanAi");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address stays visible and selectable.
    }
  };

  return (
    <div className="min-h-svh">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{t("title")}</h1>
          <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        </header>

        <nav aria-label={t("toc")} className="mt-6 rounded-3xl bg-card p-5">
          <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
            {t("toc")}
          </p>
          <ul className="mt-2 grid gap-x-4 sm:grid-cols-2">
            {SECTIONS.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="inline-flex min-h-11 items-center text-sm font-semibold hover:text-primary"
                >
                  {t(`${id}.title`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 space-y-3">
          <Section id="what" title={t("what.title")}>
            <p className="mt-3 text-sm leading-relaxed">{t("what.p1")}</p>
            <p className="mt-3 text-sm leading-relaxed">{t("what.p2")}</p>
          </Section>

          <Section id="need" title={t("need.title")}>
            <Bullets items={[t("need.pro"), t("need.claude"), t("need.chatgpt")]} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("need.note")}</p>
            <div className="mt-4 rounded-2xl bg-muted p-3">
              <p className="text-xs font-bold text-muted-foreground">{t("address.body")}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 text-sm break-all select-all">{CONNECTOR_URL}</code>
                <Button variant="secondary" size="sm" onClick={() => void copy()}>
                  {copied ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                  <span aria-live="polite">{copied ? t("address.copied") : t("address.copy")}</span>
                </Button>
              </div>
            </div>
          </Section>

          <Section id="claude" title={t("claude.title")}>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("claude.intro")}</p>
            <Steps items={CLAUDE_STEPS.map((s) => t(`claude.${s}`))} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("claude.teamNote")}</p>
          </Section>

          <Section id="chatgpt" title={t("chatgpt.title")}>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("chatgpt.intro")}</p>
            <Steps items={CHATGPT_STEPS.map((s) => t(`chatgpt.${s}`))} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("chatgpt.legacy")}</p>
          </Section>

          <Section id="try" title={t("try.title")}>
            <p className="mt-3 text-sm text-muted-foreground">{t("try.hint")}</p>
            <ul className="mt-3 space-y-2">
              {QUESTIONS.map((q) => (
                <li key={q} className="rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed">
                  {t(`try.${q}`)}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="tools" title={t("tools.title")}>
            <p className="mt-3 text-sm text-muted-foreground">{t("tools.intro")}</p>
            <Bullets items={TOOLS.map((tool) => t(`tools.${tool}`))} />
          </Section>

          <Section id="limits" title={t("limits.title")}>
            <Bullets items={LIMITS.map((l) => t(`limits.${l}`))} />
          </Section>

          <Section id="trouble" title={t("trouble.title")}>
            <div className="mt-3 space-y-4">
              {TROUBLE.map((key) => (
                <div key={key}>
                  <h3 className="text-sm font-bold">{t(`trouble.${key}.q`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`trouble.${key}.a`)}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="privacy" title={t("privacy.title")}>
            <Bullets items={PRIVACY.map((p) => t(`privacy.${p}`))} />
            <p className="mt-4 flex flex-wrap gap-x-5 text-sm font-semibold">
              <Link
                to="/privasi"
                hash="koneksi-ai"
                className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:text-primary/80"
              >
                {t("privacy.policy")}
              </Link>
              <Link
                to="/koneksi"
                className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:text-primary/80"
              >
                {t("privacy.manage")}
              </Link>
            </p>
          </Section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
