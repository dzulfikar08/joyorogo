import { cn } from "@joyorogo/ui/lib/utils";
import { basisLabel, type Basis } from "@joyorogo/api/lib/challenge";
import { fmtDateShort, fmtNumber } from "@joyorogo/i18n";
import type { TFunction } from "@joyorogo/i18n";
import { Flame } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/avatar";
import { BasisIcon } from "@/components/challenge/challenge-parts";
import type { ChallengeMember } from "@/lib/api-types";

type Day = ChallengeMember["days"][number];

const BASES: Basis[] = ["device", "photo", "manual"];

const fmtValue = (value: number) => fmtNumber(value, 1);

/** Hit days look different per backing so a self-logged day never reads as verified. */
const DOT_TONE = {
  hitDevice: "bg-primary",
  hitPhoto: "bg-primary/60",
  hitManual: "bg-primary/20 ring-2 ring-inset ring-primary/70",
  miss: "bg-destructive/30",
  pending: "border-2 border-dashed border-muted-foreground/60",
  future: "bg-muted",
} as const;

function dotTone(day: Day | undefined): string {
  if (!day) return DOT_TONE.future;
  if (day.status === "miss") return DOT_TONE.miss;
  if (day.status === "pending") return DOT_TONE.pending;
  if (day.basis === "device") return DOT_TONE.hitDevice;
  if (day.basis === "photo") return DOT_TONE.hitPhoto;
  return DOT_TONE.hitManual;
}

function dayTitle(t: TFunction<"challenge">, day: Day | undefined, unit: string): string {
  if (!day) return t("board.dayNotStarted");
  const parts: string[] = [t(`board.day.${day.status}`)];
  if (day.value !== null) parts.push(t("board.value", { value: fmtValue(day.value), unit }));
  if (day.status === "hit" && day.basis) parts.push(basisLabel(day.basis));
  return `${fmtDateShort(day.date)}: ${parts.join(", ")}`;
}

const BASIS_TONE: Record<Basis, string> = {
  device: "bg-makan-soft text-makan-ink",
  photo: "bg-muted text-muted-foreground",
  manual: "bg-bakar-soft text-bakar-ink",
};

/** One leaderboard entry: rank, score, daily dots and how the hit days were recorded. */
export function LeaderboardRow({ member, unit }: { member: ChallengeMember; unit: string }) {
  const { t } = useTranslation("challenge");
  const dots = Array.from({ length: member.totalDays }, (_, index) => member.days[index]);
  const today =
    member.todayStatus === null
      ? null
      : [
          member.todayValue !== null
            ? t("board.value", { value: fmtValue(member.todayValue), unit })
            : null,
          t(`board.day.${member.todayStatus}`),
        ]
          .filter(Boolean)
          .join(", ");

  return (
    <li
      className={cn(
        "rounded-3xl bg-card p-4",
        member.isMe && "bg-makan-soft ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="w-7 shrink-0 text-center text-lg font-extrabold tabular-nums"
          aria-label={t("board.rank", { rank: member.rank })}
        >
          {member.rank}
        </span>
        <Avatar name={member.name} image={member.image} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[0.9375rem] font-bold">
            <span className="truncate">{member.name}</span>
            {member.isMe && (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[0.6875rem] font-bold text-primary-foreground">
                {t("board.you")}
              </span>
            )}
          </p>
          <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
            {member.judgedDays === 0
              ? t("board.noJudged")
              : t("board.score", { hit: member.hitDays, judged: member.judgedDays })}
          </p>
        </div>
        {member.streak > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold tabular-nums">
            <Flame className="size-4 text-bakar" aria-hidden />
            {member.streak}
          </span>
        )}
      </div>

      {dots.length > 0 && (
        <div
          role="img"
          aria-label={t("board.dots", { hit: member.hitDays, total: member.totalDays })}
          className="mt-3 flex flex-wrap gap-1.5"
        >
          {dots.map((day, index) => (
            <span
              key={day?.date ?? `future-${index}`}
              title={dayTitle(t, day, unit)}
              className={cn("size-3.5 rounded-full", dotTone(day))}
            />
          ))}
        </div>
      )}

      {today && (
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          {t("board.today")} <span className="font-semibold text-foreground">{today}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {BASES.filter((basis) => member.hitsByBasis[basis] > 0).map((basis) => (
          <span
            key={basis}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[0.6875rem] font-bold",
              BASIS_TONE[basis],
            )}
          >
            <BasisIcon basis={basis} className="size-3" />
            {basisLabel(basis)} {member.hitsByBasis[basis]}
          </span>
        ))}
        {!member.hasData && !member.isMe && (
          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-[0.6875rem] font-bold text-muted-foreground">
            {t("board.noData")}
          </span>
        )}
      </div>
    </li>
  );
}

/** Key to the day dots: backing for hits, plus misses and the day still running. */
export function DotLegend() {
  const { t } = useTranslation("challenge");
  const items: Array<{ tone: string; label: string }> = [
    { tone: DOT_TONE.hitDevice, label: basisLabel("device") },
    { tone: DOT_TONE.hitPhoto, label: basisLabel("photo") },
    { tone: DOT_TONE.hitManual, label: basisLabel("manual") },
    { tone: DOT_TONE.miss, label: t("board.legend.miss") },
    { tone: DOT_TONE.pending, label: t("board.legend.pending") },
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn("size-3 rounded-full", item.tone)} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
