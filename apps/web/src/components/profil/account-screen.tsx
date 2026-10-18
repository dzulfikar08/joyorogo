import { useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { Camera, Mail, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { i18n } from "@joyorogo/i18n";
import { Avatar } from "@/components/avatar";
import { IconChip, ListButtonRow, ListGroup, ListRow } from "@/components/kit/surface";
import type { ProfilCtx } from "@/components/profil/shared";
import { sessionQuery } from "@/lib/auth-client";
import type { Session } from "@/lib/auth-client";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

/** Center-crops the pick into a 512px square JPEG; one shape for every upload. */
async function fileToAvatarBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error(i18n.t("settings:profile.photo.error.noCanvas"));
  }
  // Flatten alpha onto white — JPEG has no transparency anyway.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 512, 512);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, 512, 512);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** Profile photo (camera/gallery/remove) and the sign-in email. */
export function AccountScreen({ ctx }: { ctx: ProfilCtx }) {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const { name, email, image } = ctx;

  // Foto profil: unggahan dipotong jadi persegi 512px di kanvas dulu, lalu
  // disimpan server-side; sesi diperbarui langsung supaya semua layar ikut.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patchSessionImage = (cache: OptimisticCache, image: string | null) => {
    cache.value<Session>(sessionQuery.queryKey, (old) =>
      old ? { ...old, user: { ...old.user, image } } : old,
    );
  };
  const uploadAvatar = useOptimisticMutation<
    Parameters<AppRouterClient["avatar"]["upload"]>[0],
    Awaited<ReturnType<AppRouterClient["avatar"]["upload"]>>
  >({
    mutationFn: (input) => client.avatar.upload(input),
    patch: (input, cache) => {
      // Preview the local image instantly; the server URL replaces it on settle.
      const local = `data:${input.mimeType};base64,${input.imageBase64}`;
      patchSessionImage(cache, local);
    },
    invalidate: () => [orpc.social.key(), orpc.group.key()],
    success: (_input, data) => {
      const swap = new OptimisticCache(queryClient);
      patchSessionImage(swap, data.image);
      return {
        message: t("profile.photo.updated"),
        undo: () => void client.avatar.remove({}),
      };
    },
  });
  // Delayed commit: foto hilang dari sesi seketika, DELETE menyusul setelah
  // jendela undo; undo mengembalikan foto tanpa memanggil server.
  const removeAvatar = useDelayedDelete<{ id: string }>({
    remove: async () => {
      const data = await client.avatar.remove({});
      // Server may fall back to the Google picture; reflect whatever it says.
      const swap = new OptimisticCache(queryClient);
      patchSessionImage(swap, data?.image ?? null);
    },
    patch: (_row, cache) => {
      patchSessionImage(cache, null);
    },
    label: () => t("profile.photo.label"),
  });
  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error(t("profile.photo.error.tooLarge"));
      return;
    }
    try {
      const imageBase64 = await fileToAvatarBase64(file);
      uploadAvatar.mutate({ imageBase64, mimeType: "image/jpeg" });
    } catch {
      toast.error(t("profile.photo.error.unreadable"));
    }
  };

  return (
    <>
      <div className="flex flex-col items-center rounded-3xl bg-card px-5 py-6 text-center">
        <Avatar name={name ?? email ?? "?"} image={image} className="size-24 text-3xl" />
        <p className="mt-3 max-w-full truncate text-lg font-extrabold tracking-tight">
          {name ?? t("common:more.fallbackNameWeb")}
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void pickAvatar(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <ListGroup className="mt-3">
        <ListButtonRow
          icon={
            <IconChip tone="makan">
              <Camera />
            </IconChip>
          }
          title={t("profile.photo.change")}
          onClick={() => fileInputRef.current?.click()}
        />
        <ListRow
          icon={
            <IconChip tone="tidur">
              <Mail />
            </IconChip>
          }
          title={t("hubWeb.account.email")}
          subtitle={email ?? t("profile.emailFallback")}
        />
      </ListGroup>
      {image && (
        <ListGroup className="mt-7">
          <ListButtonRow
            destructive
            icon={<Trash2 aria-hidden />}
            title={t("profile.photo.remove")}
            onClick={() => removeAvatar({ id: "avatar" })}
          />
        </ListGroup>
      )}
    </>
  );
}
