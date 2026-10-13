import { Share2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";

import {
  defaultShareText,
  drawStoryCard,
  STORY_H,
  STORY_W,
  type StorySpec,
} from "@/components/story/story-card";

type ShareStoryButtonProps = {
  story: StorySpec;
  /** Empty string renders the icon only (needs `ariaLabel`). */
  label?: string;
  ariaLabel?: string;
  /** Overrides the default share copy for the card kind. */
  text?: string;
  fileName?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
};

/**
 * Draws `story` as a 1080x1920 PNG and hands it to the OS share sheet via the
 * Web Share API (mobile Chrome/Safari offer Instagram > Story there); on
 * browsers without file sharing it downloads the PNG instead. Pure data in —
 * screens own their queries, the social feed can reuse the same painters.
 */
export function ShareStoryButton({
  story,
  label = "Bagikan ke Story",
  ariaLabel,
  text,
  fileName,
  variant,
  size,
  className,
  disabled,
}: ShareStoryButtonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      await drawStoryCard(canvas, story);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Gagal membuat gambar.");
      const name = fileName ?? `joyorogo-${story.kind}.png`;
      const file = new File([blob], name, { type: "image/png" });

      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: text ?? defaultShareText(story) });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
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
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || busy}
        aria-label={label ? undefined : (ariaLabel ?? label)}
        onClick={() => void share()}
      >
        {busy && label ? (
          "Menyiapkan..."
        ) : (
          <>
            <Share2 className="size-4" aria-hidden />
            {label}
          </>
        )}
      </Button>
      <canvas ref={canvasRef} width={STORY_W} height={STORY_H} className="hidden" aria-hidden />
    </>
  );
}
