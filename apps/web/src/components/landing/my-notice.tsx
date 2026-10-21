import { matchTags } from "@joyorogo/i18n";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppConfig } from "@/lib/app-config";

const DISMISSED_KEY = "jrg-my-notice";

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Storage blocked (private mode): treat as dismissed rather than nagging every visit.
    return true;
  }
}

/**
 * A strip at the top of the Indonesian landing for visitors who read Malay: the browser's languages resolve to `ms`
 * (matchTags, which also maps Malaysian regions such as zh-MY), or the server reports their country as MY. Visitors
 * whose country is SG get the same strip in English, pointing at /sg. It never redirects, so search engines and shared
 * links land on the URL they name. Closing it is remembered on this device.
 */
export function MyNotice() {
  const config = useAppConfig();
  const [hidden, setHidden] = useState(true);
  const [readsMalay, setReadsMalay] = useState(false);

  useEffect(() => {
    setHidden(dismissed());
    setReadsMalay(matchTags(navigator.languages?.length ? navigator.languages : [navigator.language]) === "ms");
  }, []);

  const inMalaysia = config.data?.usd?.country === "MY";
  const inSingapore = config.data?.usd?.country === "SG";
  // Malay wins: someone who reads Malay or is in Malaysia gets the Malay version, even on a Singapore network.
  const market = readsMalay || inMalaysia ? "my" : inSingapore ? "sg" : null;
  if (hidden || market === null) return null;

  const close = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to persist to; hiding it for this visit is still what the person asked for.
    }
    setHidden(true);
  };

  const sg = market === "sg";
  return (
    <aside
      lang={sg ? "en-SG" : "ms"}
      aria-label={sg ? "Singapore version" : "Versi Bahasa Melayu"}
      className="border-b border-border/70 bg-makan-soft text-makan-ink"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 md:px-6">
        <p className="py-2 text-sm">
          {sg ? "In Singapore?" : "Anda di Malaysia?"}{" "}
          <Link
            to={sg ? "/sg" : "/my"}
            hrefLang={sg ? "en-SG" : "ms"}
            data-revklik-goal={sg ? "sg_notice_click" : "my_notice_click"}
            data-revklik-goal-location="landing"
            className="rounded-sm font-bold underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {sg ? "See the Singapore version" : "Lihat versi Bahasa Melayu"}
          </Link>
        </p>
        <button
          type="button"
          onClick={close}
          aria-label={sg ? "Close this notice" : "Tutup notis ini"}
          className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-makan-ink/10 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
