import { Button } from "@joyorogo/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Card, SectionTitle } from "@/components/kit/surface";
import { ConfirmSheet } from "@/components/profil/confirm-sheet";
import { apiUrl } from "@/lib/app-config";
import { client, orpc } from "@/utils/orpc";

import { DishwareForm } from "./dishware-form";
import type { Plate } from "./dishware-form";

/** "Piring saya" (Profil > Makan): renders nothing unless the allowlist flag is on. */
export function DishwareSection() {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const status = useQuery(orpc.dishware.status.queryOptions());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Plate | null>(null);
  const [deleting, setDeleting] = useState<Plate | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => client.dishware.remove({ id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.dishware.key() });
      toast.success(t("dishware.removed"));
      setDeleting(null);
    },
    onError: (err) =>
      toast.error(err instanceof Error && err.message ? err.message : t("dishware.error.remove")),
  });

  const data = status.data;
  if (!data?.enabled) return null;
  const full = data.plates.length >= data.max;

  const sizeLabel = (plate: Plate) =>
    plate.kind === "lunchbox" && plate.widthCm != null
      ? t("dishware.sizeBox", { length: plate.diameterCm, width: plate.widthCm })
      : t("dishware.size", { cm: plate.diameterCm });

  return (
    <>
      <SectionTitle className="mt-7">{t("dishware.title")}</SectionTitle>
      <Card>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("dishware.intro")}</p>
        {data.plates.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("dishware.empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.plates.map((plate) => (
              <li key={plate.id} className="flex items-center gap-3">
                <img
                  src={apiUrl(plate.photoUrl)}
                  alt=""
                  loading="lazy"
                  className="size-14 shrink-0 rounded-2xl bg-muted object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem] font-bold">{plate.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`dishware.kind.${plate.kind}`)} · {sizeLabel(plate)}
                    {plate.diameterSource === "card" && (
                      <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold">
                        {t("dishware.fromCard")}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("dishware.edit")}
                  onClick={() => setEditing(plate)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("dishware.delete")}
                  onClick={() => setDeleting(plate)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {full
              ? t("dishware.full", { max: data.max })
              : t("dishware.slots", { used: data.plates.length, max: data.max })}
          </p>
          <Button size="sm" disabled={full} onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("dishware.add")}
          </Button>
        </div>
      </Card>

      {adding && <DishwareForm open onOpenChange={setAdding} />}
      {editing && (
        <DishwareForm
          key={editing.id}
          open
          plate={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("dishware.delete")}
        body={t("dishware.deleteConfirm", { name: deleting?.name ?? "" })}
        confirmLabel={t("dishware.delete")}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
