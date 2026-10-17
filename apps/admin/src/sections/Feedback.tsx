import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThumbsUp } from "lucide-react";

import { SERVER_URL } from "../auth-client";
import {
  fmtDateTime,
  fmtNum,
  get,
  type CompactItem,
  type CorrectedScan,
  type FeedbackNegative,
  type FeedbackScan,
  type OutcomeCounts,
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
  return row.reasons.map((reason) => REASON_LABEL[reason] ?? reason).join(", ");
}

function rate(akurat: number, total: number): string {
  return total > 0 ? `${Math.round((akurat / total) * 100)}%` : "—";
}

/** Thumbnail of the rated photo; 404 is normal: scan-src expires after ~2 days and only consented photos are kept. */
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
      {row.retryDerived && <div className="mt-1 text-muted-foreground">dari tombol Hitung ulang (lama)</div>}
      {row.afterRetry && <div className="mt-1 text-muted-foreground">setelah hitung ulang</div>}
      {row.keptPhoto && <div className="mt-1 text-muted-foreground">foto disimpan (izin)</div>}
      <div>{reasonsOf(row)}</div>
    </>
  );
}

const NEGATIVE_COLUMNS: Column<FeedbackNegative>[] = [
  { key: "photo", header: "Foto", cell: (r) => <FeedbackThumb row={r} /> },
  { key: "user", header: "Pengguna", cell: (r) => r.userName ?? r.userId.slice(0, 8) },
  { key: "rating", header: "Penilaian", cell: (r) => <RatingCell row={r} /> },
  { key: "note", header: "Catatan", cell: (r) => r.note ?? "—", className: "max-w-80 whitespace-normal break-words" },
  { key: "diff", header: "AI vs disimpan", cell: (r) => <ScanDiffView row={r} />, className: "max-w-96 whitespace-normal" },
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

/** Explicit accuracy needs at least one answer that is not a retry tap. */
function explicitRate(e: FeedbackScan["explicit"]): string {
  return e.total > 0 ? rate(e.akurat, e.total) : "Belum ada penilaian";
}

/** accurate / (accurate + corrected + retried); abandoned and pending stay outside. */
function resolvedRate(c: OutcomeCounts): string {
  return rate(c.accurate, c.accurate + c.corrected + c.retried);
}

const signedPct = (value: number | null) =>
  value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("id-ID")}%`;

const OUTCOME_HEAD = ["Scan", "Tanpa koreksi", "Dikoreksi", "Hitung ulang", "Ditinggal", "Menunggu", "Tanpa koreksi %"];

function OutcomeCells({ c }: { c: OutcomeCounts }) {
  const resolved = c.accurate + c.corrected + c.retried;
  return (
    <>
      <td className={num}>{fmtNum(resolved + c.abandoned + c.pending)}</td>
      <td className={num}>{fmtNum(c.accurate)}</td>
      <td className={num}>{fmtNum(c.corrected)}</td>
      <td className={num}>{fmtNum(c.retried)}</td>
      <td className={num}>{fmtNum(c.abandoned)}</td>
      <td className={num}>{fmtNum(c.pending)}</td>
      <td className={`${num} font-semibold`}>{resolvedRate(c)}</td>
    </>
  );
}

type SessionView = Pick<FeedbackNegative, "aiItems" | "retryLog" | "savedItems" | "diff">;

const kcalOf = (items: CompactItem[]) => items.reduce((sum, item) => sum + item.k, 0);

/** "Nasi 200 g, 300 kkal (P 5 K 60 L 1, 80% yakin)": macros and confidence only when the scan has them. */
function itemText(item: CompactItem): string {
  const macros = [
    item.p !== undefined ? `P ${fmtNum(item.p)}` : null,
    item.c !== undefined ? `K ${fmtNum(item.c)}` : null,
    item.f !== undefined ? `L ${fmtNum(item.f)}` : null,
    item.fi !== undefined ? `S ${fmtNum(item.fi)}` : null,
    item.cf !== undefined ? `${Math.round(item.cf * 100)}% yakin` : null,
  ].filter(Boolean);
  return `${item.n}${item.g !== undefined ? ` ${fmtNum(item.g)} g` : ""}, ${fmtNum(item.k)} kkal${
    macros.length > 0 ? ` (${macros.join(", ")})` : ""
  }`;
}

function ItemsLine({ label, items, hint }: { label: string; items: CompactItem[]; hint?: string }) {
  return (
    <div className="break-words">
      <span className="text-muted-foreground">{label}: </span>
      {hint && <span className="text-muted-foreground">[{hint}] </span>}
      {items.map(itemText).join("; ")}{" "}
      <span className="text-muted-foreground">(total {fmtNum(kcalOf(items))} kkal)</span>
    </div>
  );
}

/** AI answer (first pass, each retry pass) vs diary items and the diff, readable on a phone. */
function ScanDiffView({ row }: { row: SessionView }) {
  const { aiItems, retryLog, savedItems, diff } = row;
  if (!aiItems) {
    return <p className="text-xs text-muted-foreground">Tidak ada data sesi scan.</p>;
  }
  const lines: { sign: string; tone: string; text: string }[] = [];
  if (diff) {
    for (const r of diff.renamed) {
      lines.push({ sign: "~", tone: "text-amber-600", text: `${r.from.n} jadi ${r.to.n}` });
    }
    for (const r of diff.removed) lines.push({ sign: "−", tone: "text-red-600", text: itemText(r) });
    for (const r of diff.added) lines.push({ sign: "+", tone: "text-emerald-600", text: itemText(r) });
    for (const r of diff.changed) {
      const parts = [
        r.g ? `${fmtNum(r.g[0])} → ${fmtNum(r.g[1])} g` : null,
        r.k ? `${fmtNum(r.k[0])} → ${fmtNum(r.k[1])} kkal` : null,
      ].filter(Boolean);
      lines.push({ sign: "Δ", tone: "text-amber-600", text: `${r.n}: ${parts.join(", ")}` });
    }
  }
  const delta = diff && diff.aiKcal > 0 ? Math.round(((diff.savedKcal - diff.aiKcal) / diff.aiKcal) * 100) : null;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <ItemsLine label="AI (pertama)" items={aiItems} />
      {retryLog?.map((pass) => (
        <ItemsLine
          key={pass.i}
          label={`Hitung ulang ${pass.i} (${pass.model})`}
          hint={pass.hint}
          items={pass.items}
        />
      ))}
      {savedItems && <ItemsLine label="Disimpan" items={savedItems} />}
      {savedItems && diff ? (
        <>
          {lines.length === 0 && <div className="text-muted-foreground">Disimpan tanpa perubahan.</div>}
          {lines.map((line, i) => (
            <div key={i} className="flex gap-1.5 break-words">
              <span className={`w-3 shrink-0 text-center font-semibold ${line.tone}`}>{line.sign}</span>
              <span>{line.text}</span>
            </div>
          ))}
          <div className="font-medium">
            Disimpan {fmtNum(diff.savedKcal)} kkal vs AI {fmtNum(diff.aiKcal)} kkal
            {delta !== null && ` (${delta > 0 ? "+" : ""}${delta}% dari AI)`}
          </div>
        </>
      ) : (
        <div className="text-muted-foreground">Belum disimpan ke catatan.</div>
      )}
    </div>
  );
}

const CORRECTED_COLUMNS: Column<CorrectedScan>[] = [
  { key: "user", header: "Pengguna", cell: (r) => r.userName ?? r.userId?.slice(0, 8) ?? "—" },
  { key: "diff", header: "AI vs disimpan", cell: (r) => <ScanDiffView row={r} />, className: "max-w-xl whitespace-normal" },
  { key: "model", header: "Model", cell: (r) => r.model ?? "—", className: "text-muted-foreground" },
  { key: "at", header: "Waktu", cell: (r) => fmtDateTime(r.createdAt), className: "whitespace-nowrap" },
];

/** "Hasilnya akurat?" — implicit accuracy, kcal bias, explicit ratings, paged negative results. */
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

  const correctedPaging = usePaging(params, set, { page: "cpage", pageSize: "cpageSize" });
  const csp = new URLSearchParams({
    page: String(correctedPaging.page),
    pageSize: String(correctedPaging.pageSize),
  });
  const corrected = useQuery({
    queryKey: ["feedback-corrected", csp.toString()],
    queryFn: () => get<Paged<"corrections", CorrectedScan>>(`/api/admin/feedback/corrected?${csp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(corrected.data?.total, correctedPaging, !corrected.isPlaceholderData);

  const f = feedback.data;
  const byDay = [...(f?.byDay ?? [])].sort((a, b) => b.day.localeCompare(a.day));
  const byModel = [...(f?.byModel ?? [])].sort((a, b) => b.total - a.total);
  const outcomeDays = [...(f?.outcomes.byDay ?? [])].sort((a, b) => b.day.localeCompare(a.day));
  const sessionTotal = (c: OutcomeCounts) =>
    c.accurate + c.corrected + c.retried + c.abandoned + c.pending;
  const outcomeModels = [...(f?.outcomes.byModel ?? [])].sort(
    (a, b) => sessionTotal(b) - sessionTotal(a),
  );

  const dash = feedback.isPending ? "…" : "—";
  const oc = f?.outcomes.total;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Tanpa koreksi 30 hari"
          value={oc ? resolvedRate(oc) : dash}
          hint={
            oc
              ? `${fmtNum(oc.accurate)} dari ${fmtNum(oc.accurate + oc.corrected + oc.retried)} scan selesai (tanpa koreksi + dikoreksi + hitung ulang)`
              : undefined
          }
        />
        <StatCard label="Dikoreksi" value={oc ? fmtNum(oc.corrected) : dash} />
        <StatCard label="Hitung ulang" value={oc ? fmtNum(oc.retried) : dash} />
        <StatCard
          label="Ditinggal"
          value={oc ? fmtNum(oc.abandoned) : dash}
          hint={oc ? `di luar hitungan; ${fmtNum(oc.pending)} masih menunggu` : undefined}
        />
      </div>

      <SectionCard title="Bias kalori (scan dikoreksi, 30 hari)" flush>
        <QueryBoundary
          query={feedback}
          skeletonRows={2}
          isEmpty={(d) => d.bias.total.n === 0}
          empty={{ icon: ThumbsUp, title: "Belum ada scan yang dikoreksi" }}
        >
          {(d) => (
            <>
              <p className="px-4 py-2 text-xs text-muted-foreground">
                Selisih kkal AI terhadap yang disimpan pengguna. Plus = AI kelewat tinggi, minus = AI kelewat rendah (lebih parah).
              </p>
              <StatTable head={["Model", "Dikoreksi", "Terlalu tinggi", "Terlalu rendah", "Rata-rata", "Rata-rata tinggi", "Rata-rata rendah"]}>
                {[{ model: "Semua" as string | null, ...d.bias.total }, ...d.bias.byModel].map((row) => (
                  <tr key={row.model ?? "?"}>
                    <td className="font-medium">{row.model ?? "(tanpa model)"}</td>
                    <td className={num}>{fmtNum(row.n)}</td>
                    <td className={num}>{fmtNum(row.over)}</td>
                    <td className={`${num} font-semibold`}>{fmtNum(row.under)}</td>
                    <td className={num}>{signedPct(row.meanPct)}</td>
                    <td className={num}>{signedPct(row.meanOverPct)}</td>
                    <td className={`${num} font-semibold`}>{signedPct(row.meanUnderPct)}</td>
                  </tr>
                ))}
              </StatTable>
            </>
          )}
        </QueryBoundary>
      </SectionCard>

      <SectionCard title="Hasil scan per hari (WIB)" flush>
        <QueryBoundary
          query={feedback}
          skeletonRows={3}
          isEmpty={(d) => d.outcomes.byDay.length === 0}
          empty={{ icon: ThumbsUp, title: "Belum ada scan" }}
        >
          {() => (
            <StatTable head={["Hari", ...OUTCOME_HEAD]}>
              {outcomeDays.map((day) => (
                <tr key={day.day}>
                  <td>{day.day}</td>
                  <OutcomeCells c={day} />
                </tr>
              ))}
            </StatTable>
          )}
        </QueryBoundary>
      </SectionCard>

      <SectionCard title="Hasil scan per model" flush>
        <QueryBoundary
          query={feedback}
          skeletonRows={3}
          isEmpty={(d) => d.outcomes.byModel.length === 0}
          empty={{ icon: ThumbsUp, title: "Belum ada scan" }}
        >
          {() => (
            <StatTable head={["Model", ...OUTCOME_HEAD]}>
              {outcomeModels.map((row) => (
                <tr key={row.model ?? "?"}>
                  <td className="font-medium">{row.model ?? "(tanpa model)"}</td>
                  <OutcomeCells c={row} />
                </tr>
              ))}
            </StatTable>
          )}
        </QueryBoundary>
      </SectionCard>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Akurasi penilaian 30 hari"
          value={f ? explicitRate(f.explicit) : dash}
          hint={
            f && f.explicit.total > 0
              ? `${fmtNum(f.explicit.akurat)} akurat dari ${fmtNum(f.explicit.total)} penilaian`
              : undefined
          }
        />
        <StatCard label="Kurang akurat" value={f ? fmtNum(f.explicit.kurang) : dash} />
        <StatCard label="Salah" value={f ? fmtNum(f.explicit.salah) : dash} />
        <StatCard
          label="Dari tombol Hitung ulang (lama)"
          value={f ? fmtNum(f.retryLegacy) : dash}
          hint="bukan penilaian, tidak masuk akurasi"
        />
      </div>

      <SectionCard title="Penilaian per hari (WIB)" flush>
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

      <SectionCard title="Penilaian per model" flush>
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
        {f && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            {fmtNum(f.negatives.total)} hasil negatif, {fmtNum(f.negatives.afterRetry)} setelah hitung ulang.
          </p>
        )}
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
                    <div className="mt-2">
                      <ScanDiffView row={r} />
                    </div>
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

      <SectionCard title="Scan dikoreksi (AI vs disimpan)" flush>
        <QueryBoundary
          query={corrected}
          isEmpty={(d) => d.corrections.length === 0}
          empty={{ icon: ThumbsUp, title: "Belum ada scan yang dikoreksi" }}
        >
          {(d) => (
            <>
              <DataList
                rows={d.corrections}
                rowKey={(r) => r.id}
                columns={CORRECTED_COLUMNS}
                switchAt="3xl"
                card={(r) => (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-sm font-medium">
                        {r.userName ?? r.userId?.slice(0, 8) ?? "—"}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{fmtDateTime(r.createdAt)}</span>
                    </div>
                    <div className="mt-2">
                      <ScanDiffView row={r} />
                    </div>
                    <CardFacts
                      facts={[
                        { label: "Model", value: r.model ?? "—" },
                        { label: "Hitung ulang", value: fmtNum(r.retries) },
                        { label: "Koreksi", value: fmtNum(r.corrections) },
                      ]}
                    />
                  </>
                )}
              />
              <Pagination
                page={d.page}
                pageSize={d.pageSize}
                total={d.total}
                onPage={correctedPaging.setPage}
                onPageSize={correctedPaging.setPageSize}
              />
            </>
          )}
        </QueryBoundary>
      </SectionCard>
    </div>
  );
}
