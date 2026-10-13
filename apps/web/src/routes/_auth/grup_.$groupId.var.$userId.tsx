import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ChevronLeft, CircleAlert, CircleCheck, CircleDashed, EyeOff, Flag, Hand, Info, RotateCcw, ScanLine, Tv, Utensils, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { apiUrl } from "@/lib/app-config";
import { useSession } from "@/lib/auth-client";
import { fmtInt } from "@/lib/format";
import type { VarScan } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/grup_/$groupId/var/$userId")({
  component: VarPage,
});

/** Ultrasound-style fan: apex at the transducer (top), bowed edges, wide base. */
const CONE_CLIP = "polygon(50% 3%, 84% 44%, 99% 100%, 1% 100%, 16% 44%)";

/** Deterministic bobbing slots inside the cone; six covers most food diaries. */
const FOOD_SLOTS = [
  { x: 36, y: 40 },
  { x: 58, y: 34 },
  { x: 28, y: 62 },
  { x: 52, y: 58 },
  { x: 68, y: 52 },
  { x: 43, y: 78 },
] as const;

const SCAN_MS = 2400;

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

function VarPage() {
  const { groupId, userId } = Route.useParams();
  const reducedMotion = usePrefersReducedMotion();

  // Navigated from the detail page, so member names are already in cache.
  const detail = useQuery(orpc.group.detail.queryOptions({ input: { groupId } }));
  const session = useSession();
  const target = detail.data?.members.find((m) => m.userId === userId);
  const targetName = target?.name ?? "dia";
  const isSelf = session.data?.user.id === userId;
  // Hidden members skip the theatrics: there is nothing to reveal after 2.4 s.
  const hidden = !(target?.shareFood ?? true);

  const scan = useQuery({
    ...orpc.group.varScan.queryOptions({ input: { groupId, userId } }),
    enabled: false,
  });

  const [phase, setPhase] = useState<"aim" | "scan" | "reveal">("aim");
  const [progress, setProgress] = useState(0);
  const [theatricsDone, setTheatricsDone] = useState(false);
  const [fetchDone, setFetchDone] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
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
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (phase !== "scan") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - startedAt) / SCAN_MS) * 100));
    }, 80);
    const finish = window.setTimeout(() => setTheatricsDone(true), SCAN_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(finish);
    };
  }, [phase]);

  // The reveal waits for BOTH the theatrics beat and the server answer, so a
  // slow fetch never reveals an empty cone (the old race).
  useEffect(() => {
    if (phase === "scan" && theatricsDone && fetchDone) {
      setPhase(scanError !== null ? "aim" : "reveal");
    }
  }, [phase, theatricsDone, fetchDone, scanError]);

  const startScan = () => {
    setProgress(0);
    setTheatricsDone(false);
    setFetchDone(false);
    setScanError(null);
    setPhase("scan");
    void scan
      .refetch()
      .then((result) => {
        setFetchDone(true);
        if (result.isError) {
          setScanError(result.error?.message ?? "Gagal memindai.");
        }
      })
      .catch(() => {
        setFetchDone(true);
        setScanError("Gagal memindai. Cek koneksimu lalu coba lagi.");
      });
  };

  const nudge = useMutation(
    orpc.group.nudge.mutationOptions({
      onSuccess: () => toast.success("Colek terkirim"),
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white select-none">
      {/* Top broadcast bar */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link
          to="/grup/$groupId"
          params={{ groupId }}
          aria-label="Tutup VAR"
          className="grid size-11 place-items-center rounded-full bg-white/10 backdrop-blur focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <X className="size-5" aria-hidden />
        </Link>
        <span className="rounded-md border-2 border-white/70 px-3 py-1 text-sm font-black tracking-[0.2em] italic uppercase">
          VAR Check
        </span>
        {/* Spacer keeps the banner centred. */}
        <span className="size-11" aria-hidden />
      </div>

      {/* Scan viewport */}
      <div className="relative mx-auto mt-4 w-full max-w-lg flex-1">
        <div className="absolute inset-0" style={{ clipPath: CONE_CLIP }}>
          {camError ? (
            <div className="size-full bg-[radial-gradient(ellipse_at_top,#12211c_0%,#020403_70%)]" />
          ) : (
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="size-full object-cover grayscale brightness-75 contrast-125"
            />
          )}
          {/* USG green cast + scanlines + grain */}
          <div aria-hidden className="absolute inset-0 bg-emerald-300/15 mix-blend-color" />
          <div
            aria-hidden
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.55) 0 2px, transparent 2px 4px)",
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.07] mix-blend-screen"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
            }}
          />
          {/* Sweeping scan line */}
          {!reducedMotion && phase !== "reveal" && (
            <div
              aria-hidden
              className={cn(
                "absolute inset-x-[4%] h-[3px] rounded-full bg-emerald-200 shadow-[0_0_18px_5px_rgba(52,211,153,0.55)]",
                phase === "scan" ? "var-sweep-fast" : "var-sweep",
              )}
            />
          )}
          {/* Floating foods on reveal */}
          {phase === "reveal" && scan.data && !scan.data.hidden && (
            <ul aria-label={`Makanan ${scan.data.name ?? "teman"} hari ini`}>
              {scan.data.foods.slice(0, FOOD_SLOTS.length).map((food, index) => {
                const slot = FOOD_SLOTS[index]!;
                return (
                  <li
                    key={`${food.name}-${index}`}
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2",
                      !reducedMotion && "var-bob",
                    )}
                    style={{
                      left: `${slot.x}%`,
                      top: `${slot.y}%`,
                      animationDelay: `${index * 0.35}s`,
                    }}
                  >
                    {food.photoUrl ? (
                      <img
                        src={apiUrl(food.photoUrl)}
                        alt={food.name}
                        className="size-16 rounded-full border-2 border-emerald-200/70 object-cover shadow-float"
                      />
                    ) : (
                      <span className="grid size-14 place-items-center rounded-full border-2 border-emerald-200/70 bg-black/60">
                        <Utensils className="size-6 text-emerald-200" aria-hidden />
                      </span>
                    )}
                    <span className="mt-1 block max-w-28 truncate rounded-full bg-black/65 px-2 py-0.5 text-center text-[0.625rem] font-bold">
                      {food.name} · {fmtInt(food.kcal)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Cone outline + edge glow (same fan geometry as the clip). */}
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <path
            d="M50 3 L84 44 Q95 70 99 100 L1 100 Q5 70 16 44 Z"
            fill="none"
            stroke="rgba(167,243,208,0.45)"
            strokeWidth="0.7"
          />
        </svg>

        {/* Center reticle while aiming */}
        {phase === "aim" && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
            <div className="mx-auto grid size-24 place-items-center rounded-full border-2 border-dashed border-emerald-200/80">
              <ScanLine className="size-8 text-emerald-200" aria-hidden />
            </div>
            <p className="mt-3 text-sm font-bold text-emerald-100 drop-shadow">
              {hidden
                ? `${targetName} menyembunyikan isi perutnya`
                : `Arahkan ke perut ${targetName}`}
            </p>
          </div>
        )}

        {/* Scan readout */}
        {phase === "scan" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center" role="status">
            <p className="text-sm font-black tracking-[0.25em] text-emerald-200">MEMINDAI…</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 font-mono text-[0.6875rem] text-emerald-100/80">
              <Activity className="size-3.5" aria-hidden />
              beeping… {Math.round(progress)}%
            </p>
          </div>
        )}
      </div>

      {/* Verdict + totals */}
      <div className="relative z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        {/* Hidden members get the honest card straight away — no fake scan. */}
        {hidden ? (
          <VerdictCard scan={scan.data ?? null} targetName={targetName} />
        ) : (
          <>
            {phase === "reveal" && scan.data && <VerdictCard scan={scan.data} targetName={targetName} />}
            {scanError !== null && phase === "aim" && (
              <div className="mx-auto mb-3 max-w-lg rounded-3xl bg-card p-4 text-card-foreground shadow-float" role="alert">
                <p className="flex items-center justify-center gap-1.5 text-center text-[0.9375rem] font-bold text-destructive">
                  <CircleAlert className="size-5 shrink-0" aria-hidden />
                  VAR gagal memindai
                </p>
                <p className="mt-1 text-center text-sm text-muted-foreground">{scanError}</p>
              </div>
            )}
          </>
        )}
        <div className="mx-auto flex max-w-lg items-center justify-center gap-3">
          {!hidden && phase === "reveal" ? (
            <>
              <Button
                variant="secondary"
                className="flex-1 bg-white/10 text-white hover:bg-white/20"
                onClick={() => {
                  setScanError(null);
                  setPhase("aim");
                }}
              >
                <RotateCcw className="size-4" aria-hidden />
                Scan ulang
              </Button>
              {!isSelf && (
                <Button
                  className="flex-1"
                  disabled={nudge.isPending}
                  onClick={() => nudge.mutate({ groupId, toUserId: userId, kind: "poke" })}
                >
                  <Hand className="size-4" aria-hidden />
                  Colek
                </Button>
              )}
            </>
          ) : (
            <>
              <Link
                to="/grup/$groupId"
                params={{ groupId }}
                className="grid size-14 shrink-0 place-items-center rounded-full bg-white/10 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                aria-label="Kembali ke grup"
              >
                <ChevronLeft className="size-6" aria-hidden />
              </Link>
              {!hidden && (
                <Button size="lg" className="flex-1" disabled={phase === "scan"} onClick={startScan}>
                  <ScanLine className="size-5" aria-hidden />
                  {phase === "scan" ? "Memindai…" : "Scan"}
                </Button>
              )}
            </>
          )}
        </div>
        {camError && (
          <p className="mt-2 text-center text-xs text-white/60">
            Kamera tidak tersedia. Overlay tetap jalan, coba izinkan kamera di pengaturan browser.
          </p>
        )}
      </div>
    </div>
  );
}

/** Label tanggal pendek untuk chip status VAR: "12 Okt". */
function varDayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Salinan verdict perut VAR perut (mirror lib/varscan.ts untuk klien). */
function bellyVerdictLabel(verdict: NonNullable<VarScan["varStatus"]>["verdict"]): string {
  switch (verdict) {
    case "turun":
      return "Perut mengecil";
    case "naik":
      return "Terlihat lebih penuh";
    case "sama":
      return "Belum kelihatan beda";
    case "beda":
      return "Kondisi foto beda";
    case "pertama":
      return "Scan pertama";
  }
}

function VerdictCard({ scan, targetName }: { scan: VarScan | null; targetName: string }) {
  // Hidden member and the query has not run (or failed): still show why.
  if (scan === null) {
    return (
      <div className="mx-auto mb-3 max-w-lg rounded-3xl bg-card p-4 text-card-foreground shadow-float">
        <p className="flex items-center justify-center gap-1.5 text-center text-[0.9375rem] font-bold">
          <EyeOff className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          {targetName} menyembunyikan isi perutnya
        </p>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Total kalori tetap terlihat di kartu anggotanya.
        </p>
      </div>
    );
  }
  const target = scan.eatTargetKcal;
  const over = target !== null ? scan.eatenKcal - target : null;
  const firstName = (scan.name ?? targetName).split(" ")[0] ?? targetName;
  return (
    <div className="mx-auto mb-3 max-w-lg rounded-3xl bg-card p-4 text-card-foreground shadow-float">
      {scan.hidden ? (
        <p className="flex items-center justify-center gap-1.5 text-center text-[0.9375rem] font-bold">
          <EyeOff className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          {scan.name ?? "Teman"} menyembunyikan isi perutnya
        </p>
      ) : scan.verdict === "aman" ? (
        <p className="flex items-center justify-center gap-1.5 text-center text-[0.9375rem] font-bold text-primary">
          <CircleCheck className="size-5 shrink-0" aria-hidden />
          AMAN, lanjutkan!
        </p>
      ) : scan.verdict === "offside" ? (
        <p className="flex items-center justify-center gap-1.5 text-center text-[0.9375rem] font-bold text-destructive">
          <Flag className="size-5 shrink-0" aria-hidden />
          OFFSIDE! +{fmtInt(over ?? 0)} kcal
        </p>
      ) : scan.verdict === "tanpa_target" ? (
        <p className="flex items-center justify-center gap-1.5 text-center text-[0.9375rem] font-bold">
          <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          Belum ada target pembanding
        </p>
      ) : (
        <p className="flex items-center justify-center gap-1.5 text-center text-[0.9375rem] font-bold">
          <CircleDashed className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          Perut kosong… belum makan?
        </p>
      )}
      <p className="mt-1 text-center text-sm text-muted-foreground">
        Total hari ini {fmtInt(scan.eatenKcal)}
        {target !== null ? ` dari ${fmtInt(target)} kcal` : " kcal"}
      </p>
      <p className="mt-1 text-center text-xs text-muted-foreground/80">
        Berdasarkan catatan makan {firstName} hari ini, bukan foto asli.
      </p>
      {scan.varStatus && (
        <p className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-center text-xs font-semibold text-muted-foreground">
          <Tv className="size-3.5 shrink-0" aria-hidden />
          VAR perut {firstName} ({varDayLabel(scan.varStatus.date)}):{" "}
          {bellyVerdictLabel(scan.varStatus.verdict)}
        </p>
      )}
    </div>
  );
}
