import { fmtDateMedium } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Loader2, Trash2, Watch, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, IconChip } from "@/components/kit";
import { PRICING_URL } from "@/components/pro-wall";
import { BlockSkeleton, QueryError } from "@/components/states";
import { FitApiError, fitApi, fitApiWithStatus } from "@/lib/fit-api";
import { SERVER_URL } from "@/lib/env";
import { fmtFileSize, wibDay } from "@/lib/format";
import {
  MAX_FACE_BYTES,
  MAX_FACES,
  type UploadOutcome,
  type WatchFace,
  checkFaceFile,
  downloadName,
  faceUploadError,
} from "@/lib/watchfaces";

import { DropZone } from "./drop-zone";

const KEY = ["fit-api", "watchfaces"] as const;

interface Attempt {
  id: number;
  name: string;
  /** Null while it is being uploaded. */
  outcome: UploadOutcome | null;
}

let nextAttempt = 1;

/** The account's watch face library: upload `.hwt` files, and list, download and delete what is there. */
export function WatchfaceLibrary() {
  const { t } = useTranslation("fitWebUpload");
  const queryClient = useQueryClient();
  const library = useQuery({
    queryKey: KEY,
    queryFn: () => fitApi<{ watchfaces: WatchFace[] }>("/watchfaces"),
    staleTime: 0,
  });
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (id: number, outcome: UploadOutcome) =>
    setAttempts((all) => all.map((a) => (a.id === id ? { ...a, outcome } : a)));

  async function upload(files: File[]) {
    if (files.length === 0) return;
    const added = files.map((file): Attempt => ({
      id: nextAttempt++,
      name: file.name,
      outcome: null,
    }));
    setAttempts((all) => [...added, ...all]);
    setBusy(true);
    try {
      for (const [index, file] of files.entries()) {
        const attempt = added[index] as Attempt;
        const invalid = checkFaceFile(file);
        if (invalid) {
          patch(attempt.id, invalid);
          continue;
        }
        try {
          // The browser sets Content-Length from the Blob; the file is the whole body.
          const { status, data } = await fitApiWithStatus<WatchFace>(
            `/watchfaces?filename=${encodeURIComponent(file.name)}`,
            {
              method: "POST",
              headers: { "content-type": "application/octet-stream" },
              body: file,
            },
          );
          // 201 is a new face, 200 the same file already in the library.
          patch(attempt.id, { ok: true, face: data, existing: status === 200 });
        } catch (error) {
          patch(attempt.id, faceUploadError(error));
          if (error instanceof FitApiError && (error.status === 402 || error.status === 401)) break;
        }
      }
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: KEY });
    }
  }

  const faces = library.data?.watchfaces;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t("watchfaces.title")} subtitle={t("watchfaces.intro")} />
        <DropZone
          accept=".hwt"
          onFiles={(files) => void upload(files)}
          title={t("watchfaces.drop.title")}
          activeTitle={t("watchfaces.drop.active")}
          or={t("watchfaces.drop.or")}
          button={t("watchfaces.drop.button")}
          hint={t("watchfaces.drop.hint", { mb: MAX_FACE_BYTES / 1024 / 1024, max: MAX_FACES })}
        />
        {attempts.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2" aria-live="polite">
            {attempts.map((attempt) => (
              <AttemptRow
                key={attempt.id}
                attempt={attempt}
                onDismiss={() => setAttempts((all) => all.filter((a) => a.id !== attempt.id))}
                disabled={busy && attempt.outcome === null}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t("watchfaces.list.label")}
          subtitle={faces ? t("watchfaces.list.count", { count: faces.length }) : undefined}
        />
        {library.error ? (
          <QueryError error={library.error} onRetry={() => void library.refetch()} />
        ) : !faces ? (
          <BlockSkeleton className="h-32" />
        ) : faces.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <IconChip className="mb-3 size-12 bg-muted text-muted-foreground">
              <Watch className="size-5" aria-hidden />
            </IconChip>
            <p className="text-base font-bold">{t("watchfaces.list.emptyTitle")}</p>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              {t("watchfaces.list.emptyBody")}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {faces.map((face) => (
              <FaceRow key={face.id} face={face} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AttemptRow({
  attempt,
  onDismiss,
  disabled,
}: {
  attempt: Attempt;
  onDismiss: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("fitWebUpload");
  const { outcome } = attempt;
  let tone: "muted" | "good" | "bad" = "muted";
  let icon = <Loader2 className="size-3.5 animate-spin" aria-hidden />;
  let text: string = t("watchfaces.state.uploading");
  let pricing = false;
  if (outcome?.ok) {
    tone = "good";
    icon = <CheckCircle2 className="size-3.5" aria-hidden />;
    text = outcome.existing ? t("watchfaces.state.existing") : t("watchfaces.state.saved");
  } else if (outcome) {
    tone = "bad";
    icon = <AlertTriangle className="size-3.5" aria-hidden />;
    pricing = outcome.reason === "paywall";
    text =
      outcome.reason === "invalid_hwt" && outcome.detail
        ? t("watchfaces.errors.invalid_hwt", { reason: outcome.detail })
        : outcome.reason === "too_large"
          ? t("watchfaces.errors.too_large", { mb: MAX_FACE_BYTES / 1024 / 1024 })
          : outcome.reason === "library_full"
            ? t("watchfaces.errors.library_full", { max: MAX_FACES })
            : outcome.reason === "invalid_hwt"
              ? t("watchfaces.errors.invalid_hwt_plain")
              : t(`watchfaces.errors.${outcome.reason}`);
  }
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-muted/50 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold break-all">{attempt.name}</p>
        <p
          className={cn(
            "mt-1 flex items-start gap-1.5 text-xs",
            tone === "good"
              ? "text-recovery"
              : tone === "bad"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span className="min-w-0">{text}</span>
        </p>
        {pricing && (
          <Button size="xs" className="mt-2" nativeButton={false} render={<a href={PRICING_URL} />}>
            {t("watchfaces.action.pricing")}
          </Button>
        )}
      </div>
      {!disabled && (
        <button
          type="button"
          aria-label={t("watchfaces.action.dismiss")}
          onClick={onDismiss}
          className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

function FaceRow({ face }: { face: WatchFace }) {
  const { t } = useTranslation("fitWebUpload");
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState<"download" | "delete" | null>(null);
  const [failed, setFailed] = useState<"download" | "delete" | null>(null);

  async function download() {
    setWorking("download");
    setFailed(null);
    try {
      // A credentialed fetch, not a link: the session cookie is what lets the file through.
      const response = await fetch(
        `${SERVER_URL}/api/fit/watchfaces/${encodeURIComponent(face.id)}/file`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(face);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed("download");
    } finally {
      setWorking(null);
    }
  }

  async function remove() {
    setWorking("delete");
    setFailed(null);
    try {
      await fitApi<{ deleted: boolean }>(`/watchfaces/${encodeURIComponent(face.id)}`, {
        method: "DELETE",
      });
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch {
      setFailed("delete");
      setConfirming(false);
    } finally {
      setWorking(null);
    }
  }

  return (
    <li className="rounded-2xl bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <IconChip className="size-9 bg-primary/10 text-primary">
          <Watch className="size-4" aria-hidden />
        </IconChip>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-bold break-words">{face.name}</p>
          <p className="text-xs break-all text-muted-foreground">{face.filename}</p>
          <p className="text-xs text-muted-foreground">
            {fmtFileSize(face.size)} ·{" "}
            {t("watchfaces.row.added", { date: fmtDateMedium(wibDay(face.createdAt / 1000)) })}
          </p>
        </div>
        {confirming ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <p className="w-full text-xs font-semibold sm:w-auto">
              {t("watchfaces.action.confirm", { name: face.name })}
            </p>
            <Button
              size="xs"
              variant="destructive"
              disabled={working !== null}
              onClick={() => void remove()}
            >
              {working === "delete" && <Loader2 className="animate-spin" aria-hidden />}
              {t("watchfaces.action.confirmYes")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={working !== null}
              onClick={() => setConfirming(false)}
            >
              {t("watchfaces.action.cancel")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={working !== null}
              onClick={() => void download()}
            >
              {working === "download" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {t("watchfaces.action.download")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={working !== null}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden />
              {t("watchfaces.action.delete")}
            </Button>
          </div>
        )}
      </div>
      {failed && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t(`watchfaces.errors.${failed}`)}
        </p>
      )}
    </li>
  );
}
