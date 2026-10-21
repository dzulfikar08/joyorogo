import { fmtMyr } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { AppLink } from "@/components/app-link";
import { useAppConfig } from "@/lib/app-config";
import type { AppConfig } from "@/lib/app-config";
import { CONTACT_EMAIL } from "@/lib/landing-ms";

const MYR_PENDING = "Harga Pro dalam RM diumumkan sebelum pelancaran di Malaysia";

const ringgit = (sen: number) => fmtMyr(sen / 100, "ms");

/** Daily AI photo allowance as sold: the cap when the server sets one, unlimited when it does not. */
const scanText = (cap: number | null) => (cap === null ? "foto AI tanpa had harian" : `${cap} foto AI sehari`);

/**
 * The ringgit answer follows the server's config: prices only when `myr` is set, a plain statement when it is not,
 * and nothing until the config has loaded (an empty answer is better than a guessed one).
 */
export function ringgitFaq(config: AppConfig | undefined): Array<{ q: string; a: string }> {
  if (!config) return [];
  const q = "Boleh bayar dalam ringgit?";
  if (!config.paywall) return [{ q, a: "Pada pelayan ini semua ciri percuma, termasuk foto AI tanpa had harian." }];
  const free = `Ciri percuma boleh digunakan tanpa bayaran, dengan ${scanText(config.freeDailyScans)}.`;
  if (!config.myr) return [{ q, a: `${MYR_PENDING}. ${free}` }];
  const { monthlySen, yearlySen } = config.myr;
  return [
    {
      q,
      a: `Ya. Pro ${ringgit(monthlySen)} sebulan atau ${ringgit(yearlySen)} setahun, setara ${ringgit(Math.round(yearlySen / 12))} sebulan. Bayar dengan kad, Apple Pay atau Google Pay melalui Polar. ${free}`,
    },
  ];
}

function Point({ children, tone }: { children: ReactNode; tone: "free" | "pro" }) {
  return (
    <li className="flex gap-2">
      <Check
        className={`mt-0.5 size-4 shrink-0 ${tone === "pro" ? "text-makan-ink" : "text-primary"}`}
        aria-hidden
      />
      {children}
    </li>
  );
}

/**
 * Free tier and Pro as one ledger: two stacked rows rather than two tier cards. Every number is read from
 * /api/config; loading and failure get their own text (the page must not look finished while it has no prices).
 */
export function HargaMy() {
  const config = useAppConfig();
  const data = config.data;

  if (config.isPending) {
    return (
      <p role="status" className="rounded-[1.75rem] bg-card p-6 text-[0.9375rem] text-muted-foreground">
        Memuatkan harga dan had harian dari pelayan JoyoRogo...
      </p>
    );
  }
  if (!data) {
    return (
      <p role="alert" className="rounded-[1.75rem] bg-card p-6 text-[0.9375rem] leading-relaxed">
        Harga tidak dapat dimuatkan sekarang. Muat semula halaman ini, atau e-mel{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    );
  }
  if (!data.paywall) {
    return (
      <p className="rounded-[1.75rem] bg-card p-6 text-[0.9375rem] leading-relaxed">
        Pada pelayan ini semua ciri percuma, termasuk foto AI tanpa had harian.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.75rem]">
      <div className="bg-card p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-xl font-extrabold tracking-tight">Percuma</h3>
          <p className="text-sm text-muted-foreground">tanpa kad, tanpa tarikh tamat</p>
        </div>
        <ul className="mt-4 space-y-2 text-[0.9375rem]">
          <Point tone="free">
            {data.freeDailyScans === null ? "Foto AI tanpa had harian" : `${data.freeDailyScans} foto AI sehari`}
          </Point>
          <Point tone="free">Diari makan, senaman, berat dan tidur</Point>
          <Point tone="free">Tiada iklan</Point>
        </ul>
        <Button
          variant="secondary"
          className="mt-6"
          render={
            <AppLink to="/login" data-revklik-goal="signup_click" data-revklik-goal-location="my-harga" />
          }
        >
          Daftar percuma dengan Google
        </Button>
      </div>
      <div className="bg-makan-soft p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-xl font-extrabold tracking-tight text-makan-ink">Pro</h3>
          {data.myr ? (
            <p className="text-4xl font-extrabold tracking-tight tabular-nums">
              {ringgit(data.myr.monthlySen)}
              <span className="ml-1.5 text-base font-semibold text-makan-ink/80">sebulan</span>
            </p>
          ) : (
            <p className="max-w-xs text-[0.9375rem] font-semibold text-makan-ink sm:text-right">{MYR_PENDING}</p>
          )}
        </div>
        <ul className="mt-4 space-y-2 text-[0.9375rem]">
          <Point tone="pro">
            {data.founderDailyCap === null
              ? "Foto AI tanpa had harian"
              : `Sehingga ${data.founderDailyCap} foto AI sehari`}
          </Point>
          <Point tone="pro">Lencana Pro di profil anda</Point>
          <Point tone="pro">Sokongan keutamaan: laporan dan permintaan ciri anda didahulukan</Point>
          {data.myr && (
            <>
              <Point tone="pro">
                Pelan tahunan {ringgit(data.myr.yearlySen)} setahun, setara{" "}
                {ringgit(Math.round(data.myr.yearlySen / 12))} sebulan
              </Point>
              <Point tone="pro">
                Bayar dengan kad, Apple Pay atau Google Pay melalui Polar. Diperbaharui secara automatik sehingga
                anda membatalkannya; urus atau batalkan dari Profil.
              </Point>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
