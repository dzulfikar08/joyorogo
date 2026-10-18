import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { AndroidMark } from "@/components/android-mark";
import { AppleMark } from "@/components/apple-mark";
import { FooterLandscape } from "@/components/footer-landscape";
import { ANDROID_ROBOT_CREDIT } from "@/lib/credits";
import { PLAY_STORE_URL, useAppConfig } from "@/lib/app-config";
import { IOS_TESTFLIGHT_LIVE, JOYOROGO_TESTFLIGHT_URL } from "@/lib/testflight";

const SOURCE_URL = "https://github.com/dzulfikar08/joyorogo";
const JOYOFIT_URL = "https://fit.joyorogo.com";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold hover:text-primary";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="mt-2 flex flex-col">{children}</ul>
    </div>
  );
}

/**
 * Footer for public pages (landing, harga, privasi): brand line, the links
 * every public page needs, and the painted panorama underneath. The
 * signed-in app has its own chrome.
 */
export function PublicFooter() {
  const config = useAppConfig();
  return (
    <footer className="mt-8">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-8 px-4 pt-14 pb-4 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-10 md:px-6">
        <div className="col-span-2 max-w-sm md:col-span-1">
          <p className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto" />
            JoyoRogo
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Tiga angka tiap hari: boleh <span className="font-semibold text-makan-ink">
              makan
            </span>{" "}
            berapa, harus <span className="font-semibold text-bakar-ink">bakar</span> berapa, butuh{" "}
            <span className="font-semibold text-tidur-ink">tidur</span> berapa jam.
          </p>
          <p className="mt-4 flex items-start gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Dibuat di Malang oleh Dzulfikar. Foto asli tidak disimpan, kecuali kamu memintanya.
          </p>
        </div>

        <nav aria-label="Tautan" className="contents">
          <Column title="Produk">
            {config.data?.paywall && (
              <li>
                <Link to="/harga" className={linkClass}>
                  Harga
                </Link>
              </li>
            )}
            <li>
              <a href={JOYOFIT_URL} target="_blank" rel="noopener" className={linkClass}>
                JoyoFit
              </a>
            </li>
            <li>
              <a href="/blog/" className={linkClass}>
                Blog
              </a>
            </li>
            <li>
              <Link to="/panduan/ai" className={linkClass}>
                Panduan Claude/ChatGPT
              </Link>
            </li>
            <li>
              <Link to="/privasi" className={linkClass}>
                Privasi
              </Link>
            </li>
          </Column>
          <Column title="Unduh">
            <li>
              <a
                href={PLAY_STORE_URL}
                data-revklik-goal="play_store_click"
                data-revklik-goal-location="footer"
                className={linkClass}
              >
                <AndroidMark className="size-4" />
                Google Play
              </a>
            </li>
            {IOS_TESTFLIGHT_LIVE && (
              <li>
                <a
                  href={JOYOROGO_TESTFLIGHT_URL}
                  target="_blank"
                  rel="noopener"
                  data-revklik-goal="ios_testflight_click"
                  data-revklik-goal-location="footer"
                  className={linkClass}
                >
                  <AppleMark className="size-4" />
                  iPhone (TestFlight)
                </a>
              </li>
            )}
            <li>
              <Link to="/login" className={linkClass}>
                Masuk
              </Link>
            </li>
          </Column>
          <Column title="Terbuka">
            <li>
              <a href={SOURCE_URL} className={linkClass}>
                Kode sumber
              </a>
            </li>
          </Column>
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 pt-4 pb-2 text-xs leading-relaxed text-muted-foreground md:px-6">
        <p>© {new Date().getFullYear()} JoyoRogo · AGPL-3.0</p>
        <p>{ANDROID_ROBOT_CREDIT}</p>
      </div>

      <FooterLandscape />
    </footer>
  );
}
