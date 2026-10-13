// Foto profil: satu unggahan per pengguna, disimpan di R2 di bawah
// avatars/<userId>/<id>.<ext> dan disajikan publik via /avatar/<userId>/<file>.
// URL-nya (relatif, /avatar/...) disimpan di kolom user.image, jadi feed,
// inbox, grup, dan profil publik langsung menampilkannya. Foto Google tetap
// diketahui lewat metadata objek (customMetadata.g) supaya "Hapus foto"
// bisa kembali ke foto Google tanpa tabel tambahan.

const AVATAR_EXT = ["jpg", "png", "webp"] as const;
export type AvatarExt = (typeof AVATAR_EXT)[number];

export const AVATAR_MIME_BY_EXT: Record<AvatarExt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function avatarExt(mimeType: string): AvatarExt | null {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

/** avatars/<userId>/<id>.<ext> — id is the same 32-hex capability as scans. */
export function avatarKey(userId: string, id: string, ext: AvatarExt): string {
  return `avatars/${userId}/${id}.${ext}`;
}

export function avatarPrefix(userId: string): string {
  return `avatars/${userId}/`;
}

/** Public path stored in user.image, e.g. /avatar/<userId>/<id>.jpg */
export function avatarPublicUrl(userId: string, id: string, ext: AvatarExt): string {
  return `/avatar/${userId}/${id}.${ext}`;
}

/**
 * Parses a custom-upload URL back to its R2 key; null for anything else
 * (Google photo URLs, null, garbage). The route serves exactly these keys.
 */
export function customAvatarKey(image: string | null | undefined): string | null {
  if (!image) return null;
  const match = /^\/avatar\/([^/]+)\/([0-9a-f]{32})\.(jpg|png|webp)$/.exec(image);
  return match ? `avatars/${match[1]}/${match[2]}.${match[3]}` : null;
}

/**
 * The Google photo to fall back to when this avatar is deleted: the previous
 * avatar carries it in its metadata once a custom upload replaced a Google
 * photo, so uploads chain the value forward.
 */
export async function avatarFallbackImage(
  bucket: { get(key: string): Promise<{ customMetadata?: Record<string, string> } | null> },
  previousImage: string | null,
): Promise<string | null> {
  const previousKey = customAvatarKey(previousImage);
  if (!previousKey) return previousImage;
  const old = await bucket.get(previousKey);
  return old?.customMetadata?.g || null;
}
