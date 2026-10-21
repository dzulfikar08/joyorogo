import { Button } from "@joyorogo/ui/components/button";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** The formats, in the order the buttons show. Kept here, not imported from the export library, so that stays a lazy chunk. */
const FORMATS = ["gpx", "fit", "json"] as const;
type Format = (typeof FORMATS)[number];

/** Which message an export error gets: the export library's errors are told apart by name, so it need not be imported. */
function errorKey(
  error: unknown,
): "noGps" | "notFound" | "unreadable" | "network" | "unauthorized" | "failed" {
  if (!(error instanceof Error)) return "failed";
  if (error.name === "NoGpsError") return "noGps";
  if (error.name !== "SourceError") return "failed";
  switch ((error as Error & { kind?: string }).kind) {
    case "not_found":
      return "notFound";
    case "bad_document":
      return "unreadable";
    case "network":
      return "network";
    case "unauthorized":
      return "unauthorized";
    default:
      return "failed";
  }
}

/** Strava's own upload page: the file is chosen from the downloads folder there (an upload by hand, not an integration). */
const STRAVA_UPLOAD_URL = "https://www.strava.com/upload/select";

/** "Ekspor" on a workout: one button per format, each fetches the stored document and downloads the file it builds. */
export function ExportWorkout({ start, hasGps }: { start: number; hasGps: boolean }) {
  const { t } = useTranslation("fitWebConnect");
  const [busy, setBusy] = useState<Format | null>(null);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
    /** A .fit or .gpx file was just saved: Strava reads both on its upload page. */
    upload?: boolean;
  } | null>(null);

  const run = async (format: Format) => {
    setBusy(format);
    setMessage(null);
    try {
      // Dynamic on purpose: code-splitting keeps the encoders and schema validation out of the main bundle (like the lazy route map).
      const { exportWorkout } = await import("@/lib/export/run");
      const name = await exportWorkout(start, format);
      setMessage({ tone: "ok", text: t("export.detail.done", { name }), upload: format !== "json" });
    } catch (error) {
      setMessage({ tone: "error", text: t(`export.detail.${errorKey(error)}`) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:items-end">
      <div
        role="group"
        aria-label={t("export.detail.group")}
        className="flex flex-wrap items-center gap-1.5"
      >
        <span className="inline-flex h-10 items-center gap-1.5 pr-1 text-sm font-semibold text-muted-foreground">
          <Download className="size-4" aria-hidden />
          {t("export.detail.label")}
        </span>
        {FORMATS.map((format) => {
          const name = t(`export.formats.${format}.name`);
          return (
            <Button
              key={format}
              variant="outline"
              size="sm"
              disabled={busy !== null || (format === "gpx" && !hasGps)}
              aria-label={t("export.detail.as", { format: name })}
              onClick={() => void run(format)}
            >
              {busy === format && <Loader2 className="animate-spin" aria-hidden />}
              {name}
            </Button>
          );
        })}
      </div>
      <p
        role="status"
        aria-live="polite"
        className={
          message?.tone === "error"
            ? "max-w-md text-xs break-words text-destructive sm:text-right"
            : "max-w-md text-xs break-words text-muted-foreground sm:text-right"
        }
      >
        {busy
          ? t("export.detail.working", { format: t(`export.formats.${busy}.name`) })
          : (message?.text ?? (hasGps ? "" : t("export.detail.noGps")))}
        {!busy && message?.upload && (
          <>
            {" "}
            <a
              href={STRAVA_UPLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              {t("export.detail.strava")}
            </a>
          </>
        )}
      </p>
    </div>
  );
}
