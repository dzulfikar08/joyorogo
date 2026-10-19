/**
 * Pure mapping behind app/+native-intent: rewrites the path of an incoming
 * deep link before expo-router matches it.
 */
export function mapNativeIntentPath(path: string): string {
  // The "Foto makanan" widget link (joyorogo://makan-ai, or a bare /makan-ai
  // from a warm start) opens the scan camera directly; keep any ?date=.
  const camera = path.match(/^(?:joyorogo:\/\/)?\/?makan-ai\/?(\?.*)?$/i);
  if (camera) return `/makan-ai${camera[1] ?? ""}`;
  const gabung = path.match(/gabung\/([A-Za-z0-9]+)/i);
  if (gabung) return `/gabung/${gabung[1]}`;
  // Removed strength logger screens now live in JoyoFit; /latihan is the archive.
  if (/latihan\/(aktif|pilih|ringkasan|rutinitas)/i.test(path)) return "/latihan";
  if (path.includes("joyorogo.com/strava")) return "/profil/strava";
  return path;
}
