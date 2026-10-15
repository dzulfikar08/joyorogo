import { MapPin } from "lucide-react";

import { Switch } from "@/components/kit/switch";
import type { LocationStatus } from "@/lib/location";

const HINT: Record<LocationStatus, string> = {
  off: "Mati secara bawaan. Cuma kamu yang bisa lihat, dan bisa kamu hapus kapan saja.",
  locating: "Mencari lokasimu...",
  ready: "Lokasi didapat. Disimpan sekitar 100 m saja, cuma kamu yang lihat.",
  denied: "Izin lokasi ditolak di browser. Izinkan dulu lewat pengaturan situs.",
  unavailable: "Lokasi belum bisa didapat. Piring tetap tersimpan tanpa lokasi.",
};

/** Opt-in switch under the place field; state comes from usePlaceLocation(). */
export function SaveLocationToggle({
  enabled,
  status,
  onChange,
}: {
  enabled: boolean;
  status: LocationStatus;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted/60 px-4 py-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-makan-soft">
        <MapPin className="size-[1.125rem] text-makan-ink" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold">Simpan lokasi tempat makan</p>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground" aria-live="polite">
          {HINT[enabled ? status : "off"]}
        </p>
      </div>
      <div className="pt-2">
        <Switch checked={enabled} onCheckedChange={onChange} label="Simpan lokasi tempat makan" />
      </div>
    </div>
  );
}
