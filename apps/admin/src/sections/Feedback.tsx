import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { SERVER_URL } from "../auth-client";
import { fmtDateTime, get, type FeedbackRecent, type FeedbackScan } from "../api";
import { Badge, SectionCard, StatCard } from "../ui";

const RATING_LABEL: Record<FeedbackRecent["rating"], string> = {
  kurang_akurat: "Kurang akurat",
  salah: "Salah",
};

const REASON_LABEL: Record<string, string> = {
  porsi: "Porsi salah",
  makanan: "Makanan salah",
  kcal_tinggi: "Kalori kelewat tinggi",
  kcal_rendah: "Kalori kelewat rendah",
};

function reasonsOf(row: FeedbackRecent): string[] {
  if (!row.reasonsJson) return [];
  try {
    const parsed = JSON.parse(row.reasonsJson) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rate(akurat: number, total: number): string {
  return total > 0 ? `${Math.round((akurat / total) * 100)}%` : "—";
}

/** Thumbnail of the rated photo; 404 is normal — scan-src expires daily. */
function FeedbackThumb({ row }: { row: FeedbackRecent }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
        kedaluwarsa
      </div>
    );
  }
  return (
    <img
      src={`${SERVER_URL}/api/admin/feedback-photo/${row.photoId}?userId=${encodeURIComponent(row.userId)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-14 shrink-0 rounded-lg bg-muted object-cover"
    />
  );
}

/** "Hasilnya akurat?" — accuracy rate per day/model + recent negative notes. */
export function FeedbackSection() {
  const feedback = useQuery({
    queryKey: ["feedback"],
    queryFn: () => get<FeedbackScan>("/api/admin/feedback?days=30"),
  });

  const byDay = [...(feedback.data?.byDay ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  const byModel = [...(feedback.data?.byModel ?? [])].sort((a, b) => b.total - a.total);
  const totals = byDay.reduce(
    (acc, day) => ({
      total: acc.total + day.total,
      akurat: acc.akurat + day.akurat,
      kurang: acc.kurang + day.kurang,
      salah: acc.salah + day.salah,
    }),
    { total: 0, akurat: 0, kurang: 0, salah: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Akurasi 30 hari"
          value={rate(totals.akurat, totals.total)}
          hint={`${totals.akurat} akurat dari ${totals.total} penilaian`}
        />
        <StatCard label="Kurang akurat" value={String(totals.kurang)} />
        <StatCard label="Salah" value={String(totals.salah)} />
        <StatCard
          label="Setelah hitung ulang"
          value={String(feedback.data?.recent.filter((row) => row.afterRetry).length ?? 0)}
          hint="dari 50 negatif terakhir"
        />
      </div>

      <SectionCard title="Akurasi per hari (WIB)">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hari</th>
                <th>Penilaian</th>
                <th>Akurat</th>
                <th>Kurang akurat</th>
                <th>Salah</th>
                <th>Akurasi</th>
              </tr>
            </thead>
            <tbody>
              {byDay.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground">
                    Belum ada penilaian.
                  </td>
                </tr>
              ) : (
                byDay
                  .slice()
                  .reverse()
                  .map((day) => (
                    <tr key={day.day}>
                      <td>{day.day}</td>
                      <td>{day.total}</td>
                      <td>{day.akurat}</td>
                      <td>{day.kurang}</td>
                      <td>{day.salah}</td>
                      <td className="font-semibold">{rate(day.akurat, day.total)}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Akurasi per model">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Penilaian</th>
                <th>Akurat</th>
                <th>Kurang akurat</th>
                <th>Salah</th>
                <th>Akurasi</th>
              </tr>
            </thead>
            <tbody>
              {byModel.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground">
                    Belum ada penilaian.
                  </td>
                </tr>
              ) : (
                byModel.map((row) => (
                  <tr key={row.model ?? "?"}>
                    <td className="font-medium">{row.model ?? "(tanpa model)"}</td>
                    <td>{row.total}</td>
                    <td>{row.akurat}</td>
                    <td>{row.kurang}</td>
                    <td>{row.salah}</td>
                    <td className="font-semibold">{rate(row.akurat, row.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Hasil negatif terbaru">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Foto</th>
                <th>Pengguna</th>
                <th>Penilaian</th>
                <th>Catatan</th>
                <th>Model</th>
                <th>Waktu</th>
              </tr>
            </thead>
            <tbody>
              {feedback.isPending ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : feedback.isError ? (
                <tr>
                  <td colSpan={6} className="text-destructive">
                    {String(feedback.error)}
                  </td>
                </tr>
              ) : feedback.data.recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground">
                    Belum ada hasil negatif.
                  </td>
                </tr>
              ) : (
                feedback.data.recent.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <FeedbackThumb row={row} />
                    </td>
                    <td>{row.userName ?? row.userId.slice(0, 8)}</td>
                    <td>
                      <Badge tone={row.rating === "salah" ? "red" : "amber"}>
                        {RATING_LABEL[row.rating]}
                      </Badge>
                      {row.afterRetry && (
                        <div className="mt-1 text-muted-foreground">setelah hitung ulang</div>
                      )}
                      <div>{reasonsOf(row).map((reason) => REASON_LABEL[reason] ?? reason).join(", ")}</div>
                    </td>
                    <td className="max-w-80 whitespace-normal">{row.note ?? "—"}</td>
                    <td className="text-muted-foreground">{row.model ?? "—"}</td>
                    <td>{fmtDateTime(row.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
