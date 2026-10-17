import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThumbsUp } from "lucide-react";

import { SERVER_URL } from "../auth-client";
import {
  fmtDateTime,
  fmtNum,
  get,
  type FeedbackNegative,
  type FeedbackScan,
  type Paged,
} from "../api";
import { useClampPage, useHashQuery, usePaging } from "../hash";
import {
  Badge,
  CardFacts,
  DataList,
  Pagination,
  QueryBoundary,
  SectionCard,
  StatCard,
  type Column,
} from "../ui";

const RATING_LABEL: Record<FeedbackNegative["rating"], string> = {
  kurang_akurat: "Kurang akurat",
  salah: "Salah",
};

const REASON_LABEL: Record<string, string> = {
  porsi: "Porsi salah",
  makanan: "Makanan salah",
  kcal_tinggi: "Kalori kelewat tinggi",
  kcal_rendah: "Kalori kelewat rendah",
};

function reasonsOf(row: FeedbackNegative): string {
  if (!row.reasonsJson) return "";
  try {
    const parsed = JSON.parse(row.reasonsJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((reason) => REASON_LABEL[String(reason)] ?? String(reason)).join(", ")
      : "";
  } catch {
    return "";
  }
}

function rate(akurat: number, total: number): string {
  return total > 0 ? `${Math.round((akurat / total) * 100)}%` : "—";
}

/** Thumbnail of the rated photo; 404 is normal — scan-src expires daily. */
function FeedbackThumb({ row }: { row: FeedbackNegative }) {
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

function RatingCell({ row }: { row: FeedbackNegative }) {
  return (
    <>
      <Badge tone={row.rating === "salah" ? "red" : "amber"}>{RATING_LABEL[row.rating]}</Badge>
      {row.afterRetry && <div className="mt-1 text-muted-foreground">setelah hitung ulang</div>}
      <div>{reasonsOf(row)}</div>
    </>
  );
}

const NEGATIVE_COLUMNS: Column<FeedbackNegative>[] = [
  { key: "photo", header: "Foto", cell: (r) => <FeedbackThumb row={r} /> },
  { key: "user", header: "Pengguna", cell: (r) => r.userName ?? r.userId.slice(0, 8) },
  { key: "rating", header: "Penilaian", cell: (r) => <RatingCell row={r} /> },
  { key: "note", header: "Catatan", cell: (r) => r.note ?? "—", className: "max-w-80 whitespace-normal break-words" },
  { key: "model", header: "Model", cell: (r) => r.model ?? "—", className: "text-muted-foreground" },
  { key: "at", header: "Waktu", cell: (r) => fmtDateTime(r.createdAt), className: "whitespace-nowrap" },
];

/** Compact numeric table: scrolls sideways on phones with the first column pinned. */
function StatTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="table-wrap table-sticky">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i > 0 ? "text-right" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const num = "text-right tabular-nums";

/** "Hasilnya akurat?" — accuracy rate per day/model + paged negative results. */
export function FeedbackSection() {
  const { params, set } = useHashQuery("feedback");
  const paging = usePaging(params, set);

  const feedback = useQuery({
    queryKey: ["feedback"],
    queryFn: () => get<FeedbackScan>("/api/admin/feedback?days=30"),
  });
  const sp = new URLSearchParams({
    page: String(paging.page),
    pageSize: String(paging.pageSize),
  });
  const negatives = useQuery({
    queryKey: ["feedback-negatives", sp.toString()],
    queryFn: () =>
      get<Paged<"negatives", FeedbackNegative>>(`/api/admin/feedback/negatives?${sp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(negatives.data?.total, paging, !negatives.isPlaceholderData);

  const f = feedback.data;
  const byDay = [...(f?.byDay ?? [])].sort((a, b) => b.day.localeCompare(a.day));
  const byModel = [...(f?.byModel ?? [])].sort((a, b) => b.total - a.total);
  const totals = byDay.reduce(
    (acc, day) => ({
      total: acc.total + day.total,
      akurat: acc.akurat + day.akurat,
      kurang: acc.kurang + day.kurang,
      salah: acc.salah + day.salah,
    }),
    { total: 0, akurat: 0, kurang: 0, salah: 0 },
  );
  const dash = feedback.isPending ? "…" : "—";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Akurasi 30 hari"
          value={f ? rate(totals.akurat, totals.total) : dash}
          hint={f ? `${fmtNum(totals.akurat)} akurat dari ${fmtNum(totals.total)} penilaian` : undefined}
        />
        <StatCard label="Kurang akurat" value={f ? fmtNum(totals.kurang) : dash} />
        <StatCard label="Salah" value={f ? fmtNum(totals.salah) : dash} />
        <StatCard
          label="Setelah hitung ulang"
          value={f ? fmtNum(f.negatives.afterRetry) : dash}
          hint={f ? `dari ${fmtNum(f.negatives.total)} hasil negatif` : undefined}
        />
      </div>

      <SectionCard title="Akurasi per hari (WIB)" flush>
        <QueryBoundary
          query={feedback}
          skeletonRows={3}
          isEmpty={(d) => d.byDay.length === 0}
          empty={{ icon: ThumbsUp, title: "Belum ada penilaian" }}
        >
          {() => (
            <StatTable head={["Hari", "Penilaian", "Akurat", "Kurang akurat", "Salah", "Akurasi"]}>
              {byDay.map((day) => (
                <tr key={day.day}>
                  <td>{day.day}</td>
                  <td className={num}>{fmtNum(day.total)}</td>
                  <td className={num}>{fmtNum(day.akurat)}</td>
                  <td className={num}>{fmtNum(day.kurang)}</td>
                  <td className={num}>{fmtNum(day.salah)}</td>
                  <td className={`${num} font-semibold`}>{rate(day.akurat, day.total)}</td>
                </tr>
              ))}
            </StatTable>
          )}
        </QueryBoundary>
      </SectionCard>

      <SectionCard title="Akurasi per model" flush>
        <QueryBoundary
          query={feedback}
          skeletonRows={3}
          isEmpty={(d) => d.byModel.length === 0}
          empty={{ icon: ThumbsUp, title: "Belum ada penilaian" }}
        >
          {() => (
            <StatTable head={["Model", "Penilaian", "Akurat", "Kurang akurat", "Salah", "Akurasi"]}>
              {byModel.map((row) => (
                <tr key={row.model ?? "?"}>
                  <td className="font-medium">{row.model ?? "(tanpa model)"}</td>
                  <td className={num}>{fmtNum(row.total)}</td>
                  <td className={num}>{fmtNum(row.akurat)}</td>
                  <td className={num}>{fmtNum(row.kurang)}</td>
                  <td className={num}>{fmtNum(row.salah)}</td>
                  <td className={`${num} font-semibold`}>{rate(row.akurat, row.total)}</td>
                </tr>
              ))}
            </StatTable>
          )}
        </QueryBoundary>
      </SectionCard>

      <SectionCard title="Hasil negatif" flush>
        <QueryBoundary
          query={negatives}
          isEmpty={(d) => d.negatives.length === 0}
          empty={{ icon: ThumbsUp, title: "Belum ada hasil negatif" }}
        >
          {(d) => (
            <>
              <DataList
                rows={d.negatives}
                rowKey={(r) => r.id}
                columns={NEGATIVE_COLUMNS}
                switchAt="3xl"
                card={(r) => (
                  <>
                    <div className="flex items-start gap-3">
                      <FeedbackThumb row={r} />
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {r.userName ?? r.userId.slice(0, 8)}
                          </span>
                          <span className="shrink-0 text-muted-foreground">{fmtDateTime(r.createdAt)}</span>
                        </div>
                        <div className="mt-1.5">
                          <RatingCell row={r} />
                        </div>
                      </div>
                    </div>
                    {r.note && <p className="mt-2 text-sm break-words">{r.note}</p>}
                    <CardFacts facts={[{ label: "Model", value: r.model ?? "—" }]} />
                  </>
                )}
              />
              <Pagination
                page={d.page}
                pageSize={d.pageSize}
                total={d.total}
                onPage={paging.setPage}
                onPageSize={paging.setPageSize}
              />
            </>
          )}
        </QueryBoundary>
      </SectionCard>
    </div>
  );
}
