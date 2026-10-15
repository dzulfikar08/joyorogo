import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Camera, ImageIcon, ScanSearch, ThumbsUp, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@joyorogo/ui/components/button";
import { ListGroup, ListRow } from "@/components/kit/surface";
import { useAppConfig } from "@/lib/app-config";
import { trackEvent } from "@/lib/analytics";
import { fmtInt } from "@/lib/format";
import { env } from "../../env.public";

type AnonItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  confidence?: number;
};

type ScanResult = { items: AnonItem[]; remaining: number };

const MAX_EDGE = 1024;

async function fileToImageBase64(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser ini tidak mendukung pengolahan gambar.");
  // Flatten alpha onto white: the vision endpoint rejects transparent PNGs.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.82);
  if (webp.startsWith("data:image/webp")) {
    return { base64: webp.slice(webp.indexOf(",") + 1), mimeType: "image/webp" };
  }
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: jpeg.slice(jpeg.indexOf(",") + 1), mimeType: "image/jpeg" };
}

const PICKER =
  "inline-flex h-12 cursor-pointer items-center gap-2 rounded-full px-5 text-[0.9375rem] font-semibold transition-colors focus-within:ring-[3px] focus-within:ring-ring/40 focus-within:outline-none";

/**
 * The anonymous scan: the real vision pipeline, ANON_SCANS free photos per
 * device before the server asks for sign-up. Photos are resized
 * client-side and never stored.
 */
export function ScanDemo() {
  const config = useAppConfig();
  const freeDaily = config.data?.freeDailyScans ?? null;
  const [result, setResult] = useState<ScanResult | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const analyze = useMutation({
    mutationFn: async (input: { imageBase64: string; mimeType: string }) => {
      const r = await fetch(`${env.VITE_SERVER_URL}/ai/scan-anon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await r.json()) as {
        items?: AnonItem[];
        remaining?: number;
        error?: string;
        paywall?: boolean;
      };
      if (!r.ok) {
        throw Object.assign(new Error(body.error ?? "Gagal menganalisis."), {
          paywall: body.paywall,
        });
      }
      return body as ScanResult;
    },
    onSuccess: (data) => {
      setResult(data);
      trackEvent("demo_scan");
    },
    onError: (err) => {
      if ((err as Error & { paywall?: boolean }).paywall) {
        setPaywall(true);
        trackEvent("demo_scan_limit");
      } else setError(err.message);
    },
  });

  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File itu bukan gambar.");
      return;
    }
    setResult(null);
    setPreviewUrl(URL.createObjectURL(file));
    setBusy(true);
    try {
      const image = await fileToImageBase64(file);
      await analyze.mutateAsync({ imageBase64: image.base64, mimeType: image.mimeType });
    } catch (err) {
      if (!(err as Error & { paywall?: boolean }).paywall) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (paywall) {
    return (
      <div className="rounded-[1.75rem] bg-card p-6 text-center shadow-float md:p-8">
        <p className="text-lg font-extrabold tracking-tight">Coba gratis sudah terpakai</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {freeDaily === null
            ? "Daftar gratis untuk lanjut scan tanpa batas harian, plus diary, grafik berat, dan rencana harianmu."
            : `Daftar gratis untuk lanjut. Akun gratis dapat ${freeDaily} foto setiap hari, plus diary, grafik berat, dan rencana harianmu.`}
        </p>
        <div className="mt-5 flex justify-center">
          <Button render={<Link to="/login" />}>Daftar dengan Google</Button>
        </div>
      </div>
    );
  }

  const total = (result?.items ?? []).reduce((sum, item) => sum + item.kcal, 0);
  const heavy = total > 550;
  const reaction =
    total > 1100
      ? "BUSSET, yakin makan segitu bro??"
      : heavy
        ? "Buset, yakin makan segitu bro??"
        : "Aman, bro";

  const pickers = (
    <div
      className={`flex flex-wrap items-center justify-center gap-3 ${busy ? "pointer-events-none opacity-50" : ""}`}
    >
      <label
        className={`${PICKER} pressable bg-primary text-primary-foreground hover:bg-primary/90`}
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Camera className="size-[1.125rem]" aria-hidden />
        {result ? "Foto lagi" : "Foto makananmu"}
      </label>
      <label
        className={`${PICKER} bg-muted hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)]`}
      >
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <ImageIcon className="size-[1.125rem]" aria-hidden />
        Pilih dari galeri
      </label>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-card shadow-float">
      {previewUrl ? (
        <div className="relative bg-muted">
          <img
            src={previewUrl}
            alt="Foto makanan yang kamu pilih"
            className="aspect-[4/3] w-full object-cover"
          />
          {busy && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-12">
              <p role="status" className="text-sm font-semibold text-white">
                Mengenali makanan, umumnya 8-15 detik...
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/25">
                <div className="h-full w-1/3 animate-[scan-progress_1.4s_ease-in-out_infinite] rounded-full bg-white motion-reduce:animate-none" />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 bg-makan-soft px-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-card text-makan-ink">
            <Camera className="size-6" aria-hidden />
          </span>
          <p className="max-w-xs text-[0.9375rem] font-semibold text-makan-ink">
            Foto piring makananmu dari atas, dengan cahaya cukup.
          </p>
        </div>
      )}

      <div className="space-y-4 p-5 md:p-6">
        {result && result.items.length === 0 && (
          <div className="text-center">
            <p className="flex items-center justify-center gap-1.5 text-[0.9375rem] font-bold">
              <ScanSearch className="size-4 text-muted-foreground" aria-hidden />
              Tidak ada makanan terdeteksi
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Coba foto lebih dekat dengan cahaya lebih terang. Sisa foto gratis: {result.remaining}
              .
            </p>
          </div>
        )}

        {result && result.items.length > 0 && (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Total foto ini</p>
                <p className="text-[2.75rem] leading-none font-extrabold tracking-tighter tabular-nums">
                  {fmtInt(total)}
                  <span className="ml-1.5 text-base font-semibold tracking-normal text-muted-foreground">
                    kcal
                  </span>
                </p>
              </div>
              <p
                className={`flex items-center gap-1.5 pb-1 text-sm font-bold ${heavy ? "text-bakar-ink" : "text-makan-ink"}`}
              >
                {heavy ? (
                  <TriangleAlert className="size-4" aria-hidden />
                ) : (
                  <ThumbsUp className="size-4" aria-hidden />
                )}
                {reaction}
              </p>
            </div>
            <ListGroup className="bg-muted/50">
              {result.items.map((item, index) => (
                <ListRow
                  key={`${item.name}-${index}`}
                  title={item.name}
                  subtitle={item.portion}
                  value={`${fmtInt(item.kcal)} kcal`}
                />
              ))}
            </ListGroup>
            <p className="text-center text-sm text-muted-foreground">
              Sisa foto gratis: {result.remaining}.{" "}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Daftar untuk menyimpannya
              </Link>
            </p>
          </>
        )}

        {pickers}

        {error && (
          <p role="alert" className="text-center text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {config.data?.anonScans ? `${config.data.anonScans} foto gratis tanpa daftar. ` : ""}
          Foto hanya dipakai untuk analisis, lalu dibuang.
        </p>
      </div>
    </div>
  );
}
