import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Camera,
  CircleCheck,
  CircleDashed,
  Info,
  Lightbulb,
  Loader2,
  MinusCircle,
  RefreshCw,
  Ruler,
  Share2,
  Timer,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FieldLabel } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { apiUrl } from "@/lib/app-config";
import { prepareImageFile, prepareVideoFrame } from "@/lib/image";
import type { VarHistory } from "@/lib/api-types";
import { client, orpc } from "@/utils/orpc";
import { removeById } from "@joyorogo/api/lib/optimistic";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { UNDO_LABEL, UNDO_TOAST_MS, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";

export const Route = createFileRoute("/_auth/grup_/$groupId/var/saya")({
  component: VarSayaPage,
});

const TIMER_SECONDS = 3;

type VarVerdict = VarHistory["scans"][number]["verdict"];

/** Short day caption: "Sen, 12 Okt". */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const CAPTURE_TIPS = [
  "Pose dan jarak yang sama tiap scan",
  "Cahaya terang, kamera sejajar perut",
  "Berdiri tegak, napas biasa",
] as const;

function verdictStyle(verdict: VarVerdict): {
  label: string;
  icon: typeof CircleCheck;
  className: string;
} {
  switch (verdict) {
    case "turun":
      return { label: "Perut mengecil", icon: CircleCheck, className: "text-primary" };
    case "naik":
      return { label: "Terlihat lebih penuh", icon: TriangleAlert, className: "text-amber-600 dark:text-amber-400" };
    case "sama":
      return { label: "Belum kelihatan beda", icon: MinusCircle, className: "text-muted-foreground" };
    case "beda":
      return { label: "Kondisi foto beda, ulangi", icon: RefreshCw, className: "text-destructive" };
    case "pertama":
      return { label: "Scan pertama tersimpan", icon: Info, className: "text-foreground" };
  }
}

function VarSayaPage() {
  const { groupId } = Route.useParams();
  const queryClient = useQueryClient();

  const history = useQuery(orpc.group.varHistory.queryOptions({ input: { groupId } }));
  const group = useQuery(orpc.group.list.queryOptions());

  const [step, setStep] = useState<"capture" | "compare">("capture");
  const [camError, setCamError] = useState(false);
  const [timerOn, setTimerOn] = useState(true);
  const [countdown, setCountdown] = useState<number | undefined>(undefined);
  const [captured, setCaptured] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const countdownRef = useRef<number | undefined>(undefined);

  const scans = history.data?.scans ?? [];
  const previous = scans.at(-2) ?? null;

  // Live camera for the guided capture; file input stays as the fallback.
  useEffect(() => {
    if (step !== "capture") return;
    let cancelled = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setCamError(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      // Leaving the capture step must not fire the shutter later.
      window.clearInterval(countdownRef.current);
      countdownRef.current = undefined;
      setCountdown(undefined);
    };
  }, [step]);

  const analyze = useMutation(
    orpc.group.varAnalyze.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.group.varHistory.queryOptions({ input: { groupId } }).queryKey });
        void queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        setCaptured(null);
        setStep("compare");
      },
      onError: (error) => {
        setCaptured(null);
        toast.error(error.message);
      },
    }),
  );

  // Optimistic shareVar flip in the history cache; undo re-applies the old value.
  const historyKey = orpc.group.varHistory.queryOptions({ input: { groupId } }).queryKey;
  const previousShare = useRef<boolean | null>(null);
  const setShare = useOptimisticMutation<
    Parameters<AppRouterClient["group"]["varSetShare"]>[0],
    unknown
  >({
    mutationFn: (input) => client.group.varSetShare(input),
    patch: (input, cache) => {
      previousShare.current = history.data?.shareVar ?? null;
      cache.value<VarHistory>(historyKey, (data) =>
        data ? { ...data, shareVar: input.shareVar } : data,
      );
    },
    invalidate: () => [orpc.group.key()],
    success: (input) => {
      const prev = previousShare.current;
      previousShare.current = null;
      if (prev === null) return undefined;
      return {
        message: input.shareVar ? "Scan perut dibagikan ke grup." : "Scan perut disembunyikan.",
        undo: () => void client.group.varSetShare({ groupId, shareVar: prev }),
      };
    },
    onError: (error) => toast.error(error.message),
  });

  // Delayed-commit delete: scan hilang dari riwayat seketika, DELETE setelah
  // jendela undo; undo mengembalikannya tanpa memanggil server.
  const removeScan = useDelayedDelete<{ id: string }>({
    remove: (row) => client.group.varDelete({ id: row.id }),
    patch: (row, cache) => {
      cache.value<VarHistory>(historyKey, (data) =>
        data ? { ...data, scans: removeById(data.scans, row.id) } : data,
      );
    },
    label: () => "Scan",
    fallback: "Scan perut",
    invalidate: () => [orpc.group.key()],
  });

  // Hitung ulang: the server re-runs the AI on the stored photo pair and
  // overwrites this scan's verdict (free, capped per scan). A failure leaves
  // the previous verdict untouched; undo puts it back, shared status included.
  const retryScan = useMutation({
    mutationFn: (input: { id: string; hint?: string }) => client.group.varRetry(input),
    onSuccess: ({ scan, previous }) => {
      void queryClient.invalidateQueries({ queryKey: orpc.group.key() });
      toast.success(`Hasil baru: ${verdictStyle(scan.verdict).label}`, {
        duration: UNDO_TOAST_MS,
        action: {
          label: UNDO_LABEL,
          onClick: () => {
            queryClient.setQueryData<VarHistory>(historyKey, (data) =>
              data
                ? {
                    ...data,
                    scans: data.scans.map((row) => (row.id === scan.id ? { ...row, ...previous } : row)),
                  }
                : data,
            );
            void client.group
              .varRestore({ id: scan.id, ...previous })
              .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Gagal mengembalikan hasil."),
              )
              .finally(() => void queryClient.invalidateQueries({ queryKey: orpc.group.key() }));
          },
        },
      });
    },
    onError: (error) => toast.error(`Hasil sebelumnya tetap dipakai. ${error.message}`),
  });

  const submit = (image: { base64: string; mimeType: "image/jpeg" }, previewUrl: string) => {
    setCaptured(previewUrl);
    analyze.mutate({ groupId, imageBase64: image.base64, mimeType: image.mimeType });
  };

  const startCountdown = () => {
    if (countdown !== undefined || analyze.isPending) return;
    let left = TIMER_SECONDS;
    setCountdown(left);
    countdownRef.current = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = undefined;
        setCountdown(undefined);
        captureNow();
      } else {
        setCountdown(left);
      }
    }, 1000);
  };

  // Leaving the capture step (or the page) must not fire the shutter later.
  useEffect(
    () => () => {
      window.clearInterval(countdownRef.current);
    },
    [],
  );

  const captureNow = () => {
    try {
      const video = videoRef.current;
      if (!video) return;
      const image = prepareVideoFrame(video);
      submit(image, `data:${image.mimeType};base64,${image.base64}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengambil foto.");
    }
  };

  const groupName =
    group.data?.find((g) => g.id === groupId)?.name ?? "grup ini";

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 pb-10">
      <PageHeaderBlock groupId={groupId} />

      {history.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label="Memuat riwayat VAR">
          <div className="h-72 animate-pulse rounded-3xl bg-muted" />
          <div className="h-24 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : history.isError ? (
        <div className="rounded-3xl bg-card p-5" role="alert">
          <p className="text-sm font-bold text-destructive">Riwayat gagal dimuat</p>
          <p className="mt-1 text-sm text-muted-foreground">{history.error.message}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void history.refetch()}>
            <RefreshCw className="size-4" aria-hidden />
            Coba lagi
          </Button>
        </div>
      ) : step === "capture" ? (
        <CaptureStep
          scans={scans}
          camError={camError}
          countdown={countdown}
          timerOn={timerOn}
          onToggleTimer={() => setTimerOn((on) => !on)}
          onCapture={timerOn ? startCountdown : captureNow}
          busy={analyze.isPending}
          captured={captured}
          videoRef={videoRef}
          onPickFile={(file) => {
            if (!file) return;
            // Preview from the original file; AI gets the resized copy.
            const previewUrl = URL.createObjectURL(file);
            void prepareImageFile(file)
              .then((image) => submit(image, previewUrl))
              .catch(() => {
                URL.revokeObjectURL(previewUrl);
                toast.error("Gagal memproses fotonya.");
              });
          }}
          galleryInputRef={galleryInputRef}
          analyzing={analyze.isPending}
          hasPrevious={previous !== null}
        />
      ) : (
        <CompareStep
          groupId={groupId}
          scans={scans}
          shareVar={history.data?.shareVar ?? false}
          latestWaist={history.data?.latestWaist ?? null}
          groupName={groupName}
          onRescan={() => setStep("capture")}
          onShare={(shareVar) => setShare.mutate({ groupId, shareVar })}
          sharePending={setShare.isPending}
          onDelete={(id) => removeScan({ id })}
          deletePending={false}
          onRetry={(id, hint, onDone) => retryScan.mutate({ id, hint }, { onSuccess: onDone })}
          retrying={retryScan.isPending}
        />
      )}
    </div>
  );
}

function PageHeaderBlock({ groupId }: { groupId: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-2">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">VAR Perut</h1>
        <p className="text-sm text-muted-foreground">
          Perkembangan perutmu dilihat AI secara visual — bukan alat ukur.
        </p>
      </div>
      <Link
        to="/grup/$groupId"
        params={{ groupId }}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-muted transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        aria-label="Kembali ke grup"
      >
        <X className="size-5" aria-hidden />
      </Link>
    </div>
  );
}

function CaptureStep({
  scans,
  camError,
  countdown,
  timerOn,
  onToggleTimer,
  onCapture,
  busy,
  captured,
  videoRef,
  onPickFile,
  galleryInputRef,
  analyzing,
  hasPrevious,
}: {
  scans: Array<{ id: string }>;
  camError: boolean;
  countdown: number | undefined;
  timerOn: boolean;
  onToggleTimer: () => void;
  onCapture: () => void;
  busy: boolean;
  captured: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onPickFile: (file: File | undefined) => void;
  galleryInputRef: React.RefObject<HTMLInputElement | null>;
  analyzing: boolean;
  hasPrevious: boolean;
}) {
  return (
    <>
      {/* Guided viewport: live camera inside the belly silhouette. */}
      <div className="relative overflow-hidden rounded-3xl bg-black" style={{ aspectRatio: "3 / 4" }}>
        {!camError && (
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="size-full object-cover"
            aria-label="Kamera untuk foto perut"
          />
        )}
        {/* Silhouette overlay: keep the belly inside the oval, phone at chest height. */}
        <svg
          aria-hidden
          viewBox="0 0 100 133"
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <rect width="100" height="133" fill="black" opacity="0.35" />
          <ellipse
            cx="50"
            cy="72"
            rx="30"
            ry="26"
            fill="none"
            stroke="white"
            strokeOpacity="0.9"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          <line x1="50" y1="20" x2="50" y2="30" stroke="white" strokeOpacity="0.6" strokeWidth="0.8" />
          <line x1="46" y1="25" x2="54" y2="25" stroke="white" strokeOpacity="0.6" strokeWidth="0.8" />
        </svg>
        <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm font-bold text-white drop-shadow">
          Perutmu di dalam garis putus-putus
        </p>
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40">
            <span className="text-8xl font-black text-white tabular-nums" role="timer">
              {countdown}
            </span>
          </div>
        )}
        {captured && (
          <img
            src={captured}
            alt="Foto yang baru diambil"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {analyzing && (
          <div className="absolute inset-0 grid place-items-center bg-black/55" role="status">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <Zap className="size-8 animate-pulse text-emerald-300" aria-hidden />
              <p className="text-sm font-bold text-white">
                {hasPrevious
                  ? "AI membandingkan dengan scan sebelumnya…"
                  : "Menyimpan scan pertamamu…"}
              </p>
              <p className="text-xs text-white/70">Biasanya 5-20 detik. Foto asli cuma tersimpan untukmu.</p>
            </div>
          </div>
        )}
        {camError && (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_top,#12211c_0%,#020403_70%)] p-6 text-center">
            <p className="text-sm text-white/80">
              Kamera tidak tersedia di perangkat ini. Pakai tombol galeri di bawah, atau izinkan
              kamera di pengaturan browser.
            </p>
          </div>
        )}
      </div>

      {/* Tips + capture controls */}
      <div className="rounded-3xl bg-card p-4">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {CAPTURE_TIPS.map((tip) => (
            <li key={tip} className="flex items-center gap-2">
              <Lightbulb className="size-4 shrink-0 text-amber-500" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onToggleTimer}
            aria-pressed={timerOn}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-bold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              timerOn ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <Timer className="size-4" aria-hidden />
            Timer {TIMER_SECONDS} dtk {timerOn ? "nyala" : "mati"}
          </button>
          <button
            type="button"
            onClick={onCapture}
            disabled={busy || countdown !== null}
            aria-label="Ambil foto perut"
            className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-float transition-transform pressable disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Camera className="size-7" aria-hidden />
          </button>
          <label
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 text-[0.8125rem] font-bold transition-colors hover:bg-accent focus-within:ring-[3px] focus-within:ring-ring/40 focus-within:outline-none",
              busy && "pointer-events-none opacity-50",
            )}
          >
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                onPickFile(file);
              }}
            />
            Galeri
          </label>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Foto perutmu privat: tidak pernah masuk feed, dan hanya kamu yang bisa membukanya.
          {scans.length > 0 ? ` ${scans.length} scan tersimpan.` : " Scan pertama jadi pembanding awal."}
        </p>
      </div>
    </>
  );
}

function CompareStep({
  groupId,
  scans,
  shareVar,
  latestWaist,
  groupName,
  onRescan,
  onShare,
  sharePending,
  onDelete,
  deletePending,
  onRetry,
  retrying,
}: {
  groupId: string;
  scans: VarHistory["scans"];
  shareVar: boolean;
  latestWaist: VarHistory["latestWaist"];
  groupName: string;
  onRescan: () => void;
  onShare: (shareVar: boolean) => void;
  sharePending: boolean;
  onDelete: (id: string) => void;
  deletePending: boolean;
  onRetry: (id: string, hint: string | undefined, onDone: () => void) => void;
  retrying: boolean;
}) {
  const [retryHint, setRetryHint] = useState("");
  const newest = scans.at(-1) ?? null;
  const previous = scans.at(-2) ?? null;
  if (!newest) return null;
  const verdict = verdictStyle(newest.verdict);
  const VerdictIcon = verdict.icon;

  return (
    <>
      {/* Verdict + comparison pair */}
      <div className="relative rounded-3xl bg-card p-4" aria-busy={retrying}>
        <p className={cn("flex items-center justify-center gap-2 text-center text-lg font-extrabold", verdict.className)}>
          <VerdictIcon className="size-6 shrink-0" aria-hidden />
          {verdict.label}
        </p>
        {newest.verdict !== "pertama" && newest.confidence !== null && (
          <div className="mx-auto mt-2 max-w-xs">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round(newest.confidence * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              Keyakinan visual ~{Math.round(newest.confidence * 100)}% — perkiraan dari foto, bukan
              pengukuran.
            </p>
          </div>
        )}
        {newest.note && (
          <p className="mt-2 text-center text-sm text-muted-foreground">{newest.note}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <ScanPhoto
            photoUrl={previous?.photoUrl ?? null}
            date={previous?.date ?? null}
            caption="Sebelumnya"
          />
          <ScanPhoto photoUrl={newest.photoUrl} date={newest.date} caption="Sekarang" highlight />
        </div>
        {retrying && (
          <div
            className="absolute inset-0 z-10 grid place-items-center rounded-3xl bg-card/80 backdrop-blur-[2px]"
            role="status"
          >
            <p className="flex items-center gap-2 text-sm font-bold text-primary animate-pulse">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              AI membaca ulang kedua foto...
            </p>
          </div>
        )}
      </div>

      {/* Hitung ulang: same photos, free, capped per scan */}
      {previous && (
        <div className="rounded-3xl bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold">Hasilnya kurang pas?</p>
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">
              {newest.retriesLeft > 0 ? `Gratis, sisa ${newest.retriesLeft}x` : "Batas hitung ulang habis"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            AI membandingkan ulang kedua foto yang sama, tanpa foto ulang dan tanpa memakai kuota scan
            harian.
            {shareVar ? ` Status yang dibagikan ke ${groupName} ikut diperbarui.` : ""}
          </p>
          {newest.retriesLeft > 0 ? (
            <div className="mt-3 space-y-3">
              <div>
                <FieldLabel htmlFor="var-retry-hint">Koreksi singkat (opsional)</FieldLabel>
                <Input
                  id="var-retry-hint"
                  value={retryHint}
                  maxLength={200}
                  onChange={(event) => setRetryHint(event.target.value)}
                  placeholder="mis. pose kedua foto sebenarnya sama"
                  autoComplete="off"
                  disabled={retrying}
                />
              </div>
              <Button
                variant="secondary"
                disabled={retrying}
                onClick={() => onRetry(newest.id, retryHint.trim() || undefined, () => setRetryHint(""))}
              >
                {retrying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Menghitung ulang...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-4" aria-hidden />
                    Hitung ulang
                  </>
                )}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-muted-foreground">
              Scan ini sudah dihitung ulang sampai batasnya. Scan lagi di lain hari ya.
            </p>
          )}
        </div>
      )}

      {/* Objective signal: the tape, not the photo */}
      <div className="rounded-3xl bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Ruler className="size-4 shrink-0 text-primary" aria-hidden />
          Angka yang lebih jujur: lingkar perut
        </p>
        {latestWaist ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Terakhir {dayLabel(latestWaist.date)}:{" "}
            <span className="font-bold text-foreground tabular-nums">{latestWaist.waistCm} cm</span>
            {latestWaist.deltaCm !== null && latestWaist.deltaCm !== 0 && (
              <span className={latestWaist.deltaCm < 0 ? " text-primary" : " text-amber-600 dark:text-amber-400"}>
                {" "}
                ({latestWaist.deltaCm > 0 ? "+" : "−"}
                {Math.abs(latestWaist.deltaCm)} cm)
              </span>
            )}
            . Foto cuma perkiraan visual — meteran yang mengukur.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Belum ada catatan meteran. <Link to="/berat" className="font-semibold text-primary underline-offset-2 hover:underline">Catat lingkar perut di Berat</Link> — itu
            sinyal objektifnya, foto hanya pelengkap.
          </p>
        )}
      </div>

      {/* Share + rescan + delete */}
      <div className="rounded-3xl bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold">
              <Share2 className="size-4 shrink-0 text-primary" aria-hidden />
              Bagikan status ke {groupName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Yang ikut terlihat cuma verdict + tanggal. Foto perutmu tidak pernah dibagikan.
            </p>
          </div>
          <Switch checked={shareVar} onCheckedChange={onShare} disabled={sharePending} label="Bagikan status VAR ke grup" />
        </div>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={onRescan}>
            <Camera className="size-4" aria-hidden />
            Scan lagi
          </Button>
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={deletePending}
            onClick={() => onDelete(newest.id)}
          >
            <Trash2 className="size-4" aria-hidden />
            Hapus scan ini
          </Button>
        </div>
      </div>

      {scans.length > 1 && (
        <HistorySection scans={scans} />
      )}
    </>
  );
}

function ScanPhoto({
  photoUrl,
  date,
  caption,
  highlight,
}: {
  photoUrl: string | null;
  date: string | null;
  caption: string;
  highlight?: boolean;
}) {
  return (
    <figure>
      <div
        className={cn(
          "overflow-hidden rounded-2xl bg-muted",
          highlight && "ring-2 ring-primary",
        )}
        style={{ aspectRatio: "3 / 4" }}
      >
        {photoUrl ? (
          <img
            src={apiUrl(photoUrl)}
            alt={`Foto perut ${caption.toLowerCase()}`}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            Belum ada
          </div>
        )}
      </div>
      <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">
        {caption}
        {date && <> · {dayLabel(date)}</>}
      </figcaption>
    </figure>
  );
}

function HistorySection({ scans }: { scans: VarHistory["scans"] }) {
  // Older first: setiap scan tersimpan sebagai pembandingan dengan scan
  // sesudahnya, jadi pasangan baris i+1/i adalah perbandingan aslinya.
  const older = [...scans].reverse();
  return (
    <section aria-label="Riwayat scan">
      <h2 className="px-1 text-sm font-bold text-muted-foreground">Riwayat scan</h2>
      <ul className="mt-2 space-y-2">
        {older.map((scan, index) => {
          const newer = older[index - 1] ?? null;
          const verdict = verdictStyle(scan.verdict);
          const VerdictIcon = verdict.icon;
          return (
            <li key={scan.id} className="rounded-3xl bg-card p-3">
              <div className="flex items-center gap-3">
                {scan.photoUrl ? (
                  <img
                    src={apiUrl(scan.photoUrl)}
                    alt={`Foto perut ${dayLabel(scan.date)}`}
                    loading="lazy"
                    className="size-14 shrink-0 rounded-2xl bg-muted object-cover"
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-muted">
                    <CircleDashed className="size-5 text-muted-foreground" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn("flex items-center gap-1.5 text-sm font-bold", verdict.className)}>
                    <VerdictIcon className="size-4 shrink-0" aria-hidden />
                    {verdict.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {dayLabel(scan.date)}
                    {scan.verdict !== "pertama" && scan.confidence !== null
                      ? ` · yakin ~${Math.round(scan.confidence * 100)}%`
                      : ""}
                    {scan.waistCm !== null ? ` · ${scan.waistCm} cm` : ""}
                  </p>
                  {scan.note && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">{scan.note}</p>
                  )}
                </div>
                {newer?.photoUrl && scan.photoUrl && (
                  <img
                    src={apiUrl(newer.photoUrl)}
                    alt={`Pembanding: ${dayLabel(newer.date)}`}
                    loading="lazy"
                    className="size-14 shrink-0 rounded-2xl bg-muted object-cover"
                    title={`Dibandingkan dengan ${dayLabel(newer.date)}`}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
