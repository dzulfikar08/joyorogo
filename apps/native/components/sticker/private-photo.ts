import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../../src/env";
import { authClient } from "@/lib/auth-client";

/** Original scan photo; the server only serves it to its owner's session. */
export function photoUrl(photoId: string): string {
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/photo/${photoId}`;
}

/**
 * Downloads the private original photo with the session cookie into the cache and
 * returns its file:// URI. The renderer never sees a remote private URL, so the cookie
 * (which an Image source cannot carry on every platform) is only needed here.
 */
export async function fetchPrivatePhoto(photoId: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (Platform.OS !== "web") {
    const cookie = await authClient.getCookie();
    if (cookie) headers.Cookie = cookie;
  }
  const dir = new Directory(Paths.cache, "stickers");
  if (!dir.exists) dir.create({ intermediates: true });
  const file = await File.downloadFileAsync(photoUrl(photoId), new File(dir, `photo-${photoId}.jpg`), {
    headers,
    idempotent: true,
  });
  return file.uri;
}
