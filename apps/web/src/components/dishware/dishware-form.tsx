import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { Camera, ImagePlus, Ruler } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { FieldLabel, Segmented } from "@/components/kit/surface";
import { apiUrl } from "@/lib/app-config";
import { client, orpc } from "@/utils/orpc";

import { fileToDishwareImage } from "./image";
import type { DishwareImage } from "./image";

export type Plate = Awaited<ReturnType<AppRouterClient["dishware"]["status"]>>["plates"][number];
type Kind = Plate["kind"];

const KINDS: readonly Kind[] = ["flat", "bowl", "rattan", "lunchbox"];

function parseCm(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Add (no `plate`) or edit (`plate`) sheet for one plate/bowl/lunchbox. */
export function DishwareForm({
  open,
  onOpenChange,
  plate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plate?: Plate;
}) {
  const { t } = useTranslation(["settings", "scan"]);
  const queryClient = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<DishwareImage | null>(null);
  const [name, setName] = useState(plate?.name ?? "");
  const [kind, setKind] = useState<Kind>(plate?.kind ?? "flat");
  const [diameter, setDiameter] = useState(plate ? String(plate.diameterCm) : "");
  const [width, setWidth] = useState(plate?.widthCm != null ? String(plate.widthCm) : "");
  const [fromCard, setFromCard] = useState(false);
  const [description, setDescription] = useState<string | null>(null);
  const [measureNote, setMeasureNote] = useState<{ text: string; error: boolean } | null>(null);
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = await fileToDishwareImage(file, t("dishware.error.save"));
      setImage(next);
      setDescription(null);
      setFromCard(false);
      setMeasureNote(null);
    } catch (err) {
      toast.error(errorText(err, t("dishware.error.save")));
    }
  };

  const measure = async () => {
    if (!image || measuring) return;
    setMeasuring(true);
    setMeasureNote(null);
    try {
      const result = await client.dishware.analyze({
        imageBase64: image.base64,
        mimeType: image.mimeType,
      });
      setDescription(result.description);
      if (result.cardDiameterCm != null) {
        setDiameter(String(result.cardDiameterCm));
        setFromCard(true);
        setMeasureNote({ text: t("dishware.measure.result", { cm: result.cardDiameterCm }), error: false });
      } else {
        setMeasureNote({ text: t("dishware.measure.noCard"), error: false });
      }
    } catch (err) {
      setMeasureNote({ text: errorText(err, t("dishware.measure.failed")), error: true });
    } finally {
      setMeasuring(false);
    }
  };

  const lunchbox = kind === "lunchbox";
  const diameterCm = parseCm(diameter);
  const widthCm = lunchbox ? parseCm(width) : null;
  const valid =
    name.trim().length > 0 &&
    diameterCm !== null &&
    (!lunchbox || widthCm !== null) &&
    (plate !== undefined || image !== null);

  const save = useMutation({
    mutationFn: async () => {
      if (diameterCm === null) throw new Error(t("dishware.error.save"));
      if (plate) {
        return client.dishware.update({
          id: plate.id,
          name: name.trim(),
          kind,
          diameterCm,
          widthCm: lunchbox ? widthCm : null,
        });
      }
      if (!image) throw new Error(t("dishware.error.save"));
      return client.dishware.create({
        imageBase64: image.base64,
        mimeType: image.mimeType,
        name: name.trim(),
        kind,
        diameterCm,
        ...(lunchbox && widthCm !== null ? { widthCm } : {}),
        diameterSource: fromCard ? "card" : "manual",
        ...(description ? { description } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.dishware.key() });
      toast.success(t("dishware.saved"));
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorText(err, t("dishware.error.save"))),
  });

  const preview = image?.previewUrl ?? (plate ? apiUrl(plate.photoUrl) : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("dishware.form.title")}>
      <div className="space-y-4">
        {!plate && (
          <div>
            <FieldLabel>{t("dishware.form.photo")}</FieldLabel>
            <div className="flex items-center gap-3">
              <div className="size-20 shrink-0 overflow-hidden rounded-2xl bg-muted">
                {preview && <img src={preview} alt="" className="size-full object-cover" />}
              </div>
              <div className="flex flex-col gap-2">
                <Button size="sm" variant="secondary" onClick={() => cameraRef.current?.click()}>
                  <Camera aria-hidden />
                  {image ? t("dishware.form.retake") : t("dishware.form.takePhoto")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => galleryRef.current?.click()}>
                  <ImagePlus aria-hidden />
                  {t("scan:idle.gallery")}
                </Button>
              </div>
            </div>
            <p className="mt-1.5 px-1 text-xs text-muted-foreground">{t("dishware.form.photoHint")}</p>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                void pickFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void pickFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        )}

        <div>
          <FieldLabel htmlFor="dishware-name">{t("dishware.form.name")}</FieldLabel>
          <Input
            id="dishware-name"
            value={name}
            maxLength={40}
            placeholder={t("dishware.form.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div>
          <FieldLabel>{t("dishware.form.kind")}</FieldLabel>
          <Segmented
            label={t("dishware.form.kind")}
            value={kind}
            onChange={setKind}
            options={KINDS.map((value) => ({ value, label: t(`dishware.kind.${value}`) }))}
          />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <FieldLabel htmlFor="dishware-diameter">
              {lunchbox ? t("dishware.form.length") : t("dishware.form.diameter")}
            </FieldLabel>
            <Input
              id="dishware-diameter"
              inputMode="decimal"
              value={diameter}
              onChange={(event) => {
                setDiameter(event.target.value);
                setFromCard(false);
              }}
            />
          </div>
          {lunchbox && (
            <div className="flex-1">
              <FieldLabel htmlFor="dishware-width">{t("dishware.form.width")}</FieldLabel>
              <Input
                id="dishware-width"
                inputMode="decimal"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
            </div>
          )}
        </div>
        <p className="-mt-2 px-1 text-xs text-muted-foreground">{t("dishware.form.diameterHelp")}</p>

        {!plate && (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={!image || measuring}
              onClick={() => void measure()}
            >
              <Ruler aria-hidden />
              {measuring ? t("dishware.form.measuring") : t("dishware.form.measureCard")}
            </Button>
            {measureNote && (
              <p
                role="status"
                className={`mt-1.5 px-1 text-xs ${measureNote.error ? "text-destructive" : "text-muted-foreground"}`}
              >
                {measureNote.text}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <Button className="w-full" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t("dishware.form.saving") : t("dishware.form.save")}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("dishware.form.cancel")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
