import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { WAIST_CUTOFF_CM } from "@joyorogo/api/lib/waist";
import { useWaistCheckIn } from "@/lib/optimistic";

import { cn } from "@joyorogo/ui/lib/utils";
import { Card, ListGroup, ListRow, SectionTitle } from "@/components/kit/surface";
import { fmtDateShort, fmtInt, fmtKg, fmtRatio, parseNum } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const historyOptions = orpc.waist.history.queryOptions({ input: { limit: 90 } });
const profileOptions = orpc.profile.myProfile.queryOptions();

const STEP_KEYS = [
  "waist.guide.step1",
  "waist.guide.step2",
  "waist.guide.step3",
  "waist.guide.step4",
] as const;

function WaistIllustration() {
  const { t } = useTranslation("berat");
  return (
    <svg
      viewBox="0 0 320 230"
      className="mx-auto h-auto w-full max-w-[360px]"
      role="img"
      aria-label={t("waist.illustration.alt")}
      fontFamily="inherit"
    >
      <path
        d="M88 2 V14 Q62 18 40 30 C46 70 58 95 64 120 C58 145 48 170 46 226 M112 2 V14 Q138 18 160 30 C154 70 142 95 136 120 C142 145 152 170 154 226"
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M62 94 Q100 116 138 94"
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth="2"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <path
        d="M58 166 Q72 150 88 163 M112 163 Q128 150 142 166"
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth="2"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <circle cx="100" cy="142" r="2.5" className="fill-muted-foreground" />
      <rect x="60" y="122" width="80" height="12" rx="3" className="fill-primary" />
      <path
        d="M72 122v5M84 122v7M96 122v5M108 122v7M120 122v5M132 122v7"
        className="stroke-card"
        strokeWidth="1.5"
      />
      <path
        d="M30 104 V158 M26 104 H34 M26 158 H34 M26 128 H34"
        className="stroke-primary"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M132 100 L170 78" className="stroke-muted-foreground" strokeWidth="1" />
      <text x="174" y="76" fontSize="12" className="fill-foreground">
        {t("waist.illustration.ribs")}
      </text>
      <path d="M144 128 L170 128" className="stroke-primary" strokeWidth="1.5" />
      <text x="174" y="126" fontSize="12" fontWeight="700" className="fill-primary">
        {t("waist.illustration.measureHere")}
      </text>
      <text x="174" y="141" fontSize="12" className="fill-foreground">
        {t("waist.illustration.middle")}
      </text>
      <path d="M138 160 L170 184" className="stroke-muted-foreground" strokeWidth="1" />
      <text x="174" y="188" fontSize="12" className="fill-foreground">
        {t("waist.illustration.pelvis")}
      </text>
    </svg>
  );
}

export function WaistSection() {
  const { t } = useTranslation(["berat", "common"]);
  const history = useQuery(historyOptions);
  const profile = useQuery(profileOptions);

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const checkIn = useWaistCheckIn((row) => t("toast.waistLogged", { cm: fmtKg(row.waistCm) }));

  const entries = history.data?.entries ?? [];
  const loggedToday = history.data?.loggedToday ?? false;
  const deltaCm = history.data?.deltaCm ?? null;
  const assessment = history.data?.assessment ?? null;
  const latest = entries.length > 0 ? entries[entries.length - 1].waistCm : null;

  const gender = profile.data?.profile?.gender;
  const heightCm = profile.data?.profile?.heightCm ?? null;
  const cutoff = gender === "female" ? WAIST_CUTOFF_CM.female : WAIST_CUTOFF_CM.male;
  const halfHeightCm =
    assessment?.halfHeightCm ?? (heightCm ? Math.round(heightCm * 5) / 10 : null);

  const submit = () => {
    const cm = parseNum(value);
    if (cm === null || cm < 40 || cm > 250) {
      setError(t("waist.error.range", { min: 40, max: 250 }));
      return;
    }
    setError(null);
    setValue("");
    checkIn.mutate({ waistCm: cm });
  };

  const statusLine =
    assessment === null
      ? null
      : assessment.band === "high"
        ? {
            text: t("waist.status.high", {
              ratio: assessment.ratio !== null ? fmtRatio(assessment.ratio) : "?",
            }),
            tone: "text-destructive",
          }
        : assessment.overCutoff || assessment.band === "raised"
          ? {
              text: t("waist.status.above"),
              tone: "text-amber-600 dark:text-amber-400",
            }
          : {
              text: t("waist.status.below"),
              tone: "text-makan-ink",
            };

  const newestFirst = [...entries].toReversed().slice(0, 5);
  const today = jakartaToday();

  return (
    <section aria-label={t("waist.title")} className="space-y-3">
      <SectionTitle>{t("waist.title")}</SectionTitle>
      <Card className="p-4 sm:p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label
            htmlFor="waist-input"
            className="text-[0.8125rem] font-semibold text-muted-foreground"
          >
            {t("waist.inputLabel")}
          </label>
          <div className="mt-1.5 flex gap-3">
            <div className="relative flex-1">
              <Input
                id="waist-input"
                type="number"
                step="0.5"
                min="40"
                max="250"
                inputMode="decimal"
                placeholder={t("waist.placeholder")}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="min-h-11 pr-12 text-base font-bold"
                aria-invalid={error !== null}
                aria-describedby={error !== null ? "waist-error" : undefined}
              />
              <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                cm
              </span>
            </div>
            <Button
              type="submit"
              variant={loggedToday ? "secondary" : "default"}
              className="min-h-11"
              disabled={checkIn.isPending}
            >
              {checkIn.isPending
                ? t("waist.saving")
                : loggedToday
                  ? t("common:actions.edit")
                  : t("common:actions.save")}
            </Button>
          </div>
          {error !== null && (
            <p id="waist-error" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {loggedToday && error === null && (
            <p className="mt-2 text-xs text-muted-foreground">{t("waist.loggedToday")}</p>
          )}
        </form>

        {assessment !== null && latest !== null && (
          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="flex items-end justify-between gap-3">
              <p className="text-4xl leading-none font-extrabold tracking-tighter tabular-nums">
                {fmtKg(latest)}
                <span className="ml-1.5 text-lg font-bold text-muted-foreground">cm</span>
              </p>
              {deltaCm !== null && (
                <p
                  className={cn(
                    "text-right text-sm font-bold tabular-nums",
                    deltaCm < 0 ? "text-makan-ink" : "text-muted-foreground",
                  )}
                >
                  {t("waist.sinceFirst", {
                    delta: `${deltaCm > 0 ? "+" : "−"}${fmtKg(Math.abs(deltaCm))}`,
                  })}
                </p>
              )}
            </div>
            {statusLine !== null && (
              <p className={cn("mt-2 text-sm font-bold", statusLine.tone)}>{statusLine.text}</p>
            )}
          </div>
        )}

        {newestFirst.length > 0 && (
          <div className="mt-4 border-t border-border/60 pt-4">
            <h3 className="text-sm font-bold">{t("waist.latest")}</h3>
            <ListGroup className="mt-2">
              {newestFirst.map((entry) => (
                <ListRow
                  key={entry.id}
                  title={entry.date === today ? t("common:date.today") : fmtDateShort(entry.date)}
                  value={`${fmtKg(entry.waistCm)} cm`}
                />
              ))}
            </ListGroup>
          </div>
        )}

        <div className="mt-4 border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => setAboutOpen((open) => !open)}
            aria-expanded={aboutOpen}
            className="pressable flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left text-sm font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {t("waist.about.title")}
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                aboutOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {aboutOpen && (
            <div className="mt-2 space-y-5">
              <p className="max-w-prose text-sm text-muted-foreground">{t("waist.about.intro")}</p>

              <div>
                <h3 className="text-sm font-bold">{t("waist.standard.title")}</h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                  <li>
                    {t("waist.standard.cutoff")}
                    {gender != null && ` ${t("waist.standard.cutoffYours", { cm: cutoff })}`}
                  </li>
                  {heightCm !== null && halfHeightCm !== null && (
                    <li>
                      {t("waist.standard.ratio", {
                        height: fmtInt(heightCm),
                        half: fmtKg(halfHeightCm),
                      })}
                    </li>
                  )}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">{t("waist.standard.source")}</p>
              </div>

              <div>
                <h3 className="text-sm font-bold">{t("waist.guide.title")}</h3>
                <div className="mt-3">
                  <WaistIllustration />
                  <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                    {STEP_KEYS.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ol>
                  <p className="mt-3 text-sm text-muted-foreground">{t("waist.guide.tip")}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
