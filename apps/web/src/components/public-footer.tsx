import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

import { AndroidMark } from "@/components/android-mark";
import { AppleMark } from "@/components/apple-mark";
import { ANDROID_ROBOT_CREDIT } from "@/lib/credits";
import { PLAY_STORE_URL, useAppConfig } from "@/lib/app-config";
import { IOS_TESTFLIGHT_LIVE, JOYOROGO_TESTFLIGHT_URL } from "@/lib/testflight";

const SOURCE_URL = "https://github.com/dzulfikar08/joyorogo";

/**
 * Footer for public pages (landing, harga, privasi): brand line and the
 * links every public page needs. The signed-in app has its own chrome.
 */
export function PublicFooter() {
  const config = useAppConfig();
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
            <img src="/brand/logo-mark.svg" alt="" className="h-6 w-auto" />
            JoyoRogo
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" aria-hidden />
            Dibuat di Malang oleh Dzulfikar. Foto asli tidak disimpan, kecuali kamu memintanya.
          </p>
        </div>
        <nav aria-label="Tautan" className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold">
          {config.data?.paywall && (
            <Link to="/harga" className="inline-flex min-h-11 items-center hover:text-primary">
              Harga
            </Link>
          )}
          <Link to="/privasi" className="inline-flex min-h-11 items-center hover:text-primary">
            Privasi
          </Link>
          <a href="/blog/" className="inline-flex min-h-11 items-center hover:text-primary">
            Blog
          </a>
          <a
            href={PLAY_STORE_URL}
            data-revklik-goal="play_store_click"
            data-revklik-goal-location="footer"
            className="inline-flex min-h-11 items-center gap-1.5 hover:text-primary"
          >
            <AndroidMark className="size-4" />
            Google Play
          </a>
          {IOS_TESTFLIGHT_LIVE && (
            <a
              href={JOYOROGO_TESTFLIGHT_URL}
              target="_blank"
              rel="noopener"
              data-revklik-goal="ios_testflight_click"
              data-revklik-goal-location="footer"
              className="inline-flex min-h-11 items-center gap-1.5 hover:text-primary"
            >
              <AppleMark className="size-4" />
              iPhone (TestFlight)
            </a>
          )}
          <a
            href={SOURCE_URL}
            className="inline-flex min-h-11 items-center hover:text-primary"
          >
            Kode sumber
          </a>
          <Link to="/login" className="inline-flex min-h-11 items-center hover:text-primary">
            Masuk
          </Link>
        </nav>
      </div>
      <p className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs leading-relaxed text-muted-foreground md:px-6">
        {ANDROID_ROBOT_CREDIT}
      </p>
    </footer>
  );
}
