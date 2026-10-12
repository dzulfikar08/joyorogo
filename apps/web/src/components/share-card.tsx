import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Share2 } from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";

import { orpc } from "@/utils/orpc";

const GEPREK_KCAL = 600;

type IconNode = readonly [
  tag: string,
  attrs: Readonly<Record<string, string | number>>,
  children?: readonly IconNode[],
];

/**
 * Lucide 1.45 icon node trees (ISC license, lucide.dev) for the five icons the
 * canvas card draws. Vendored because the react package only exports components.
 */
const CANVAS_ICONS = {
  flame: [
    [
      "path",
      {
        d: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4",
      },
    ],
  ],
  "trending-down": [
    ["path", { d: "M16 17h6v-6" }],
    ["path", { d: "m22 17-8.5-8.5-5 5L2 7" }],
  ],
  rocket: [
    ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" }],
    [
      "path",
      {
        d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09",
      },
    ],
    [
      "path",
      {
        d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z",
      },
    ],
    ["path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" }],
  ],
  drumstick: [
    ["path", { d: "M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23" }],
    ["path", { d: "m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" }],
  ],
  trophy: [
    ["path", { d: "M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" }],
    ["path", { d: "M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" }],
    ["path", { d: "M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" }],
    ["path", { d: "M4 22h16" }],
    ["path", { d: "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" }],
    ["path", { d: "M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" }],
  ],
  "clipboard-list": [
    ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1" }],
    ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M12 11h4" }],
    ["path", { d: "M12 16h4" }],
    ["path", { d: "M8 11h.01" }],
    ["path", { d: "M8 16h.01" }],
  ],
} as const satisfies Record<string, readonly IconNode[]>;

/** Draws a 24x24 lucide-style stroke node onto a canvas at (x, top) with the given pixel size. */
function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  nodes: readonly IconNode[],
  x: number,
  top: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, top);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const walk = (list: readonly IconNode[]) => {
    for (const [, attrs, children] of list) {
      ctx.beginPath();
      if (typeof attrs.d === "string") {
        ctx.stroke(new Path2D(attrs.d));
      } else if (attrs.cx !== undefined) {
        ctx.arc(Number(attrs.cx), Number(attrs.cy), Number(attrs.r), 0, Math.PI * 2);
        ctx.stroke();
      } else if (attrs.x1 !== undefined) {
        ctx.moveTo(Number(attrs.x1), Number(attrs.y1));
        ctx.lineTo(Number(attrs.x2), Number(attrs.y2));
        ctx.stroke();
      } else if (attrs.x !== undefined) {
        const rx = attrs.rx !== undefined ? Number(attrs.rx) : 0;
        ctx.roundRect(
          Number(attrs.x),
          Number(attrs.y),
          Number(attrs.width),
          Number(attrs.height),
          rx,
        );
        ctx.stroke();
      }
      if (children) walk(children);
    }
  };
  walk(nodes);
  ctx.restore();
}

/** Draws text with a lucide icon to its left; icon box is size px tall. */
function iconText(
  ctx: CanvasRenderingContext2D,
  iconName: keyof typeof CANVAS_ICONS,
  text: string,
  x: number,
  baselineY: number,
  color: string,
  size = 96,
) {
  drawLucideIcon(ctx, CANVAS_ICONS[iconName], x, baselineY - size * 0.78, size, color);
  ctx.fillText(text, x + size + 28, baselineY);
}

/**
 * Renders a 1080x1350 progress card on canvas and hands the PNG to the
 * native share sheet (Threads/WhatsApp/IG story) via Web Share API;
 * downloads it when sharing files is unsupported.
 */
export default function ShareCardButton() {
  const summary = useQuery(orpc.day.summary.queryOptions({ input: {} }));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    const s = summary.data;
    if (!s?.targets) return;
    setBusy(true);
    try {
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      canvas.width = 1080;
      canvas.height = 1350;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Browser tidak mendukung canvas.");

      const grad = ctx.createLinearGradient(0, 0, 1080, 1350);
      grad.addColorStop(0, "#0d1f12");
      grad.addColorStop(1, "#16402a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1080, 1350);

      ctx.fillStyle = "#7fd89b";
      ctx.font = "600 34px Inter, system-ui, sans-serif";
      ctx.fillText("J O Y O R O G O", 90, 130);
      ctx.fillStyle = "#c9dccf";
      ctx.font = "400 30px Inter, system-ui, sans-serif";
      ctx.fillText("Teman diet: tahu boleh makan, bakar, tidur.", 90, 185);

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 120px Inter, system-ui, sans-serif";
      iconText(ctx, "flame", `${s.streakDays} hari`, 90, 400, "#f59e0b");
      ctx.font = "500 44px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#c9dccf";
      ctx.fillText("berturut-turut catat makan", 90, 465);

      const lost = s.weightLostKg;
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 120px Inter, system-ui, sans-serif";
      if (lost > 0) {
        iconText(ctx, "trending-down", `${lost.toLocaleString("id-ID")} kg`, 90, 680, "#ffffff");
      } else {
        iconText(ctx, "rocket", "Mulai!", 90, 680, "#ffffff");
      }
      ctx.font = "500 44px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#c9dccf";
      ctx.fillText(lost > 0 ? "turun dari berat awal" : "perjalanan barusan dimulai", 90, 745);

      const geprek = Math.floor(s.weekBurnedKcal / GEPREK_KCAL);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 96px Inter, system-ui, sans-serif";
      iconText(
        ctx,
        "drumstick",
        geprek > 0
          ? `≈ ${geprek} geprek dibakar`
          : `${s.weekBurnedKcal.toLocaleString("id-ID")} kkal dibakar`,
        90,
        960,
        "#ffffff",
      );
      ctx.font = "500 44px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#c9dccf";
      ctx.fillText("dari aktivitas 7 hari terakhir", 90, 1025);

      // Server-defined milestones; the local copy mirrors day.ts for old caches.
      const milestones =
        s.milestones.length > 0
          ? s.milestones
          : [
              ...(s.streakDays >= 30 ? ["Streak 30 hari"] : []),
              ...(s.streakDays >= 7 ? ["Streak 7 hari"] : []),
              ...(lost >= 10 ? ["Turun 10 kg"] : []),
              ...(lost >= 5 ? ["Turun 5 kg"] : []),
              ...(lost >= 2 ? ["Turun 2 kg"] : []),
            ];
      const recapLines: string[] = [];
      if (milestones.length > 0) {
        recapLines.push(milestones.join(" • "));
      } else if (s.weekMeals > 0) {
        recapLines.push(
          `${s.weekMeals} makanan dicatat minggu ini ≈ ${Math.round(s.weekEatenKcal / 140)} eskoper`,
        );
      }
      if (s.weekMeals > 0) {
        recapLines.push(`P ${s.weekProtein} g • K ${s.weekCarbs} g • L ${s.weekFat} g minggu ini`);
      }
      ctx.fillStyle = "#c9dccf";
      ctx.font = "500 40px Inter, system-ui, sans-serif";
      recapLines.forEach((line, i) =>
        ctx.fillText(line, milestones.length > 0 && i === 0 ? 90 + 40 + 20 : 90, 1105 + i * 58),
      );
      if (milestones.length > 0) {
        drawLucideIcon(ctx, CANVAS_ICONS.trophy, 90, 1105 - 40 * 0.78, 40, "#f59e0b");
      } else if (s.weekMeals > 0) {
        drawLucideIcon(ctx, CANVAS_ICONS["clipboard-list"], 90, 1105 - 40 * 0.78, 40, "#c9dccf");
      }

      ctx.fillStyle = "#7fd89b";
      ctx.font = "600 40px Inter, system-ui, sans-serif";
      ctx.fillText(window.location.host, 90, 1240);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Gagal membuat gambar.");
      const file = new File([blob], "joyorogo-progress.png", { type: "image/png" });
      const text =
        lost > 0
          ? `Hari ke-${s.streakDays} diet, sudah turun ${lost.toLocaleString("id-ID")} kg. Turun berat pakai 3 angka aja`
          : `Hari ke-${s.streakDays} diet bareng JoyoRogo, 3 angka aja: makan, bakar, tidur`;

      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: "Progress JoyoRogo" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "joyorogo-progress.png";
        a.click();
        URL.revokeObjectURL(url);
        toast.info("Gambar diunduh, kirim manual ya. Browser ini belum dukung share langsung.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message || "Gagal membagikan.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => void share()} disabled={busy || !summary.data?.targets}>
        {busy ? (
          "Menyiapkan..."
        ) : (
          <>
            <Share2 className="size-4" aria-hidden />
            Bagikan
          </>
        )}
      </Button>
      <canvas ref={canvasRef} className="hidden" aria-hidden />
    </>
  );
}
