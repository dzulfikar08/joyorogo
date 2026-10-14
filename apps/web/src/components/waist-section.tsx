import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { WAIST_CUTOFF_CM } from "@joyorogo/api/lib/waist";
import { useWaistCheckIn } from "@/lib/optimistic";

import { cn } from "@joyorogo/ui/lib/utils";
import { Card, ListGroup, ListRow, SectionTitle } from "@/components/kit/surface";
import { fmtKg, fmtRatio, parseNum } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const historyOptions = orpc.waist.history.queryOptions({ input: { limit: 90 } });
const profileOptions = orpc.profile.myProfile.queryOptions();

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

/** 'YYYY-MM-DD' -> "14 Okt" (same style as the weight history list). */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]}`;
}

const STEPS = [
  "Berdiri tegak, kaki rapat, lengan rileks di samping badan.",
  "Raba tulang rusuk terbawah dan puncak tulang panggul. Lingkarkan pita ukur tepat di tengah keduanya.",
  "Pita mendatar sejajar lantai, menempel di kulit tapi tidak menekan.",
  "Baca angka di akhir buang napas biasa. Jangan menahan atau mengempiskan perut.",
] as const;

function WaistIllustration() {
  return (
    <svg
      viewBox="0 0 320 230"
      className="mx-auto h-auto w-full max-w-[360px]"
      role="img"
      aria-label="Ilustrasi: pita ukur dilingkarkan di tengah antara tulang rusuk terbawah dan puncak tulang panggul"
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
        Tulang rusuk terbawah
      </text>
      <path d="M144 128 L170 128" className="stroke-primary" strokeWidth="1.5" />
      <text x="174" y="126" fontSize="12" fontWeight="700" className="fill-primary">
        Ukur di sini:
      </text>
      <text x="174" y="141" fontSize="12" className="fill-foreground">
        tengah-tengahnya
      </text>
      <path d="M138 160 L170 184" className="stroke-muted-foreground" strokeWidth="1" />
      <text x="174" y="188" fontSize="12" className="fill-foreground">
        Puncak tulang panggul
      </text>
    </svg>
  );
}

export function WaistSection() {
  const history = useQuery(historyOptions);
  const profile = useQuery(profileOptions);

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(() => (history.data?.entries.length ?? 0) === 0);

  const checkIn = useWaistCheckIn((row) => `Lingkar perut dicatat: ${fmtKg(row.waistCm)} cm`);

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
      setError("Isi lingkar perut antara 40 dan 250 cm.");
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
            text: `Rasio lingkar perut terhadap tinggi ${assessment.ratio !== null ? fmtRatio(assessment.ratio) : "?"}: risiko tinggi. Cek gula darah dan tekanan darah di puskesmas atau dokter.`,
            tone: "text-destructive",
          }
        : assessment.overCutoff || assessment.band === "raised"
          ? {
              text: "Di atas batas sehat. Turun beberapa cm saja sudah menurunkan risiko.",
              tone: "text-amber-600 dark:text-amber-400",
            }
          : {
              text: "Di bawah batas sehat. Pertahankan.",
              tone: "text-makan-ink",
            };

  const newestFirst = [...entries].toReversed().slice(0, 5);
  const today = jakartaToday();

  return (
    <section aria-label="Lingkar perut" className="space-y-3">
      <SectionTitle>Lingkar perut</SectionTitle>
      <Card className="p-6">
        <p className="max-w-prose text-sm text-muted-foreground">
          Berat badan tidak membedakan lemak dan otot. Lingkar perut menunjukkan lemak di sekitar
          organ dalam, yang paling terkait dengan diabetes dan penyakit jantung.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="mt-5"
        >
          <label
            htmlFor="waist-input"
            className="text-[0.8125rem] font-semibold text-muted-foreground"
          >
            Lingkar perut (cm)
          </label>
          <div className="mt-2 flex gap-3">
            <div className="relative flex-1">
              <Input
                id="waist-input"
                type="number"
                step="0.5"
                min="40"
                max="250"
                inputMode="decimal"
                placeholder="misal 85"
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
              {checkIn.isPending ? "Menyimpan..." : loggedToday ? "Ubah" : "Simpan"}
            </Button>
          </div>
          {error !== null && (
            <p id="waist-error" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {loggedToday && error === null && (
            <p className="mt-2 text-sm text-muted-foreground">
              Tersimpan untuk hari ini. Menyimpan lagi menimpa angka tadi.
            </p>
          )}
        </form>

        {assessment !== null && latest !== null && (
          <div className="mt-6 border-t border-border/60 pt-5">
            <p className="text-[3.25rem] leading-none font-extrabold tracking-tighter tabular-nums">
              {fmtKg(latest)}
              <span className="ml-1.5 text-lg font-bold text-muted-foreground">cm</span>
            </p>
            {deltaCm !== null && (
              <p
                className={cn(
                  "mt-2 text-sm font-bold tabular-nums",
                  deltaCm < 0 ? "text-makan-ink" : "text-muted-foreground",
                )}
              >
                {deltaCm > 0 ? "+" : "−"}
                {fmtKg(Math.abs(deltaCm))} cm sejak ukuran pertama
              </p>
            )}
            {statusLine !== null && (
              <p className={cn("mt-3 text-sm font-bold", statusLine.tone)}>{statusLine.text}</p>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-border/60 pt-5">
          <h3 className="text-sm font-bold">Standar</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Batas obesitas sentral untuk orang Asia: pria 90 cm, wanita 80 cm.
              {gender != null && (
                <>
                  {" "}
                  Batasmu <span className="font-semibold tabular-nums">{cutoff} cm</span>.
                </>
              )}
            </li>
            {heightCm !== null && halfHeightCm !== null && (
              <li>
                Rasio lingkar perut terhadap tinggi badan sebaiknya di bawah 0,5. Untuk tinggi{" "}
                <span className="font-semibold tabular-nums">
                  {heightCm.toLocaleString("id-ID")}
                </span>{" "}
                cm, jaga lingkar perut di bawah{" "}
                <span className="font-semibold tabular-nums">{fmtKg(halfHeightCm)}</span> cm.
              </li>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Sumber: WHO Asia Pasifik (2000), Kemenkes RI, WHO Expert Consultation (2008), NICE
            (2022).
          </p>
        </div>

        <div className="mt-6 border-t border-border/60 pt-5">
          <button
            type="button"
            onClick={() => setGuideOpen((open) => !open)}
            aria-expanded={guideOpen}
            className="pressable flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left text-sm font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            Cara mengukur
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                guideOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {guideOpen && (
            <div className="mt-3">
              <WaistIllustration />
              <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                {STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3 text-sm text-muted-foreground">
                Ukur pagi hari sebelum makan. Seminggu sekali sudah cukup.
              </p>
            </div>
          )}
        </div>

        {newestFirst.length > 0 && (
          <div className="mt-6 border-t border-border/60 pt-5">
            <h3 className="text-sm font-bold">Terbaru</h3>
            <ListGroup className="mt-2">
              {newestFirst.map((entry) => (
                <ListRow
                  key={entry.id}
                  title={entry.date === today ? "Hari ini" : shortDate(entry.date)}
                  value={`${fmtKg(entry.waistCm)} cm`}
                />
              ))}
            </ListGroup>
          </div>
        )}
      </Card>
    </section>
  );
}
