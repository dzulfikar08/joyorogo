import { ENV } from "@/src/env";

/**
 * Origin web tempat aset gambar tips dilayani (/tips-img/...). Ased bundel
 * dihindari: foto dan infografis diambil dari situs web saat render.
 */
const WEB_ORIGIN = ENV.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, "") ?? "https://joyorogo.com";

/** URL absolut berkas gambar tips, misal tipImageUrl("sup-...-fig1.webp"). */
export function tipImageUrl(file: string): string {
  return `${WEB_ORIGIN}/tips-img/${file}`;
}
