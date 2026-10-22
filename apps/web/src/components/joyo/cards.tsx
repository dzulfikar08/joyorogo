import { Button } from "@joyorogo/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CONSENT_CATEGORIES } from "@joyorogo/api/lib/joyo-ai/consent";

import { AppDownload } from "@/components/app-download";
import { Card } from "@/components/kit/surface";
import { legalPath } from "@/lib/legal-path";

function CardText({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </>
  );
}

/**
 * A free account: hosted Joyo AI is Pro. The own-key engine is free, but only in the phone app (a key does not belong in a
 * browser), so the second card points there with the app-download buttons.
 */
export function ProGateCards({ canUpgrade }: { canUpgrade: boolean }) {
  const { t } = useTranslation("joyoAiWeb");
  return (
    <div className="space-y-3">
      <Card>
        <CardText title={t("gate.pro.title")} body={t("gate.pro.body")} />
        {canUpgrade ? (
          <Button className="mt-4 w-full sm:w-auto" render={<Link to="/pro" search={{ from: "profile", next: "/joyo" }} />}>
            {t("gate.pro.cta")}
          </Button>
        ) : null}
      </Card>
      <Card>
        <CardText title={t("gate.own.title")} body={t("gate.own.body")} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <AppDownload
            location="joyo-gate"
            androidLabel={t("gate.own.android")}
            iphoneLabel={t("gate.own.iphone")}
            webAppLabel={t("gate.own.webApp")}
          />
        </div>
      </Card>
    </div>
  );
}

/** Joyo AI cannot be used right now and there is nothing to ask for: under 18, an older server, or the service switched off. */
export function BlockedCard({ kind, onRetry }: { kind: "minor" | "unavailable" | "off"; onRetry?: () => void }) {
  const { t } = useTranslation("joyoAiWeb");
  return (
    <Card role="status">
      <CardText title={t(`gate.${kind}.title`)} body={t(`gate.${kind}.body`)} />
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {t("status.retry")}
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * The one-time notice before the hosted engine sends anything: who gets the data, every kind of data that leaves, what never does,
 * and that the person is an adult. The list is `CONSENT_CATEGORIES`, so a change of what is sent (and its version) shows up here.
 */
export function ConsentCard({ onAgree, onLater }: { onAgree: () => void; onLater: () => void }) {
  const { t, i18n } = useTranslation("joyoAiWeb");
  return (
    <Card aria-labelledby="joyo-consent-title">
      <h2 id="joyo-consent-title" className="text-base font-bold tracking-tight">
        {t("consent.title")}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("consent.lead")}</p>
      <ul className="mt-3 space-y-2">
        {CONSENT_CATEGORIES.map((id) => (
          <li key={id} className="flex gap-2.5 text-sm leading-relaxed">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{t(`consent.data.${id}`)}</span>
          </li>
        ))}
      </ul>
      <h3 className="mt-4 text-sm font-bold">{t("consent.whereTitle")}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("consent.where")}</p>
      <h3 className="mt-4 text-sm font-bold">{t("consent.notSentTitle")}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("consent.notSent")}</p>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("consent.adults")}</p>
      <p className="mt-2 text-sm">
        <a
          href={`${legalPath("privacy", i18n.language)}#joyo-ai-rogo`}
          target="_blank"
          rel="noopener"
          className="rounded-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {t("consent.privacy")}
        </a>
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
        <Button className="w-full sm:w-auto" onClick={onAgree}>
          {t("consent.agree")}
        </Button>
        <Button variant="ghost" className="w-full sm:w-auto" onClick={onLater}>
          {t("consent.later")}
        </Button>
      </div>
    </Card>
  );
}
