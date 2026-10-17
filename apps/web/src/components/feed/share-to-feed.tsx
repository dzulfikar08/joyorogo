import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Users2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { HandlePrompt } from "@/components/feed/handle-prompt";
import { FieldLabel, Segmented } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

type Visibility = "publik" | "grup";

/**
 * Sheet "Bagikan ke feed": caption opsional + pilih penonton (Grup/Publik).
 * `share` dipasok layar pemanggil supaya urutan simpan sumber (misal sesi
 * latihan dulu) tetap di tangan layar.
 */
export function ShareToFeedSheet({
  open,
  onOpenChange,
  title,
  preview,
  share,
  onShared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Satu baris tentang apa yang dibagikan, mis. "Sate ayam · 350 kcal". */
  preview: React.ReactNode;
  share: (input: { caption: string; visibility: Visibility }) => Promise<unknown>;
  onShared?: () => void;
}) {
  const { t } = useTranslation("feed");
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("grup");
  const [busy, setBusy] = useState(false);

  const profile = useQuery({
    ...orpc.social.myProfile.queryOptions(),
    enabled: open,
  });

  // Default visibility mengikuti pengaturan profil tiap kali sheet dibuka.
  useEffect(() => {
    if (open) {
      setCaption("");
      setVisibility(profile.data?.defaultVisibility ?? "grup");
    }
  }, [open, profile.data?.defaultVisibility]);

  // Urutan simpan ditentukan layar pemanggil (mis. sesi latihan disimpan
  // dulu); setelah sukses, sini tinggal invalidasi + umpan balik.
  const run = async () => {
    setBusy(true);
    try {
      await share({ caption: caption.trim(), visibility });
      toast.success(t("share.toast.shared"));
      queryClient.invalidateQueries({ queryKey: orpc.social.key() });
      onOpenChange(false);
      onShared?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("share.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("share.title")}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
          <div className="min-w-0 text-sm">
            <p className="font-bold">{title}</p>
            <p className="text-muted-foreground">{preview}</p>
          </div>
        </div>

        {open && <HandlePrompt className="bg-muted" />}

        <label className="block space-y-1.5">
          <FieldLabel>{t("share.caption")}</FieldLabel>
          <Textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={280}
            rows={3}
            placeholder={t("share.captionPlaceholder")}
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {caption.length}/280
          </p>
        </label>

        <div className="space-y-1.5">
          <FieldLabel>{t("share.audience")}</FieldLabel>
          {profile.isPending ? (
            <Skeleton className="h-11 rounded-full" />
          ) : (
            <Segmented<Visibility>
              label={t("share.audienceLabel")}
              value={visibility}
              onChange={setVisibility}
              options={[
                {
                  value: "grup",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Users2 className="size-4" aria-hidden />
                      {t("visibility.friends")}
                    </span>
                  ),
                },
                {
                  value: "publik",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="size-4" aria-hidden />
                      {t("visibility.publik")}
                    </span>
                  ),
                },
              ]}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {t(visibility === "grup" ? "share.hint.grup" : "share.hint.publik")}
          </p>
        </div>

        <Button className="w-full" disabled={busy} onClick={() => void run()}>
          {busy ? t("composer.busy.sharing") : t("share.submit")}
        </Button>
      </div>
    </Sheet>
  );
}
