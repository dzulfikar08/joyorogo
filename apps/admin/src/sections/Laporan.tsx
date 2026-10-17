import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText } from "lucide-react";
import type { ReactNode } from "react";

import {
  fmtDate,
  fmtDateTime,
  fmtNum,
  get,
  type AccuracyReport,
  type AccuracyReportSummary,
  type Paged,
} from "../api";
import { useClampPage, useHashQuery, usePaging } from "../hash";
import {
  Badge,
  Button,
  CardFacts,
  DataList,
  DayBars,
  Pagination,
  QueryBoundary,
  SectionCard,
  StatCard,
  StatTable,
  type Column,
} from "../ui";

const num = "text-right tabular-nums";

/** "2026-10-16" as the WIB day it names, e.g. "16 Okt". */
const dayLabel = (date: string) => fmtDate(Date.parse(`${date}T12:00:00+07:00`));
const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const secs = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} dtk`);
const signedPct = (value: number | null) =>
  value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("id-ID")}%`;

const EMAIL_LABEL: Record<NonNullable<AccuracyReportSummary["email"]>, string> = {
  sent: "Email terkirim",
  skipped_no_scans: "Tanpa scan, email dilewati",
  off: "Email mati",
  failed: "Email gagal",
};

function EmailBadge({ status }: { status: AccuracyReportSummary["email"] }) {
  if (!status) return <Badge>Email belum</Badge>;
  return <Badge tone={status === "failed" ? "red" : status === "sent" ? "green" : "muted"}>{EMAIL_LABEL[status]}</Badge>;
}

function RegressionBadge({ row }: { row: AccuracyReportSummary }) {
  if (row.flags.length > 0) return <Badge tone="red">{row.flags.length} regresi</Badge>;
  if (row.regressionF1 === null) return <Badge>Tanpa uji</Badge>;
  return <Badge tone="green">Aman</Badge>;
}

const LIST_COLUMNS = (open: (date: string) => void): Column<AccuracyReportSummary>[] => [
  {
    key: "date",
    header: "Tanggal",
    nowrap: true,
    cell: (r) => (
      <button type="button" onClick={() => open(r.date)} className="font-semibold text-primary underline-offset-2 hover:underline">
        {dayLabel(r.date)}
      </button>
    ),
  },
  { key: "total", header: "Scan", numeric: true, cell: (r) => fmtNum(r.total) },
  {
    key: "rate",
    header: "Tanpa koreksi",
    numeric: true,
    cell: (r) => (
      <>
        <span className="font-semibold">{pct(r.accurateRate)}</span>
        <span className="text-muted-foreground"> (7 hari {pct(r.weekRate)})</span>
      </>
    ),
  },
  { key: "fix", header: "Dikoreksi / ulang", numeric: true, cell: (r) => `${fmtNum(r.outcomes.corrected)} / ${fmtNum(r.outcomes.retried)}` },
  { key: "ratings", header: "Penilaian", numeric: true, cell: (r) => fmtNum(r.ratings) },
  { key: "reg", header: "Regresi", cell: (r) => <RegressionBadge row={r} /> },
  {
    key: "problems",
    header: "Masalah teratas",
    className: "max-w-80 whitespace-normal break-words",
    cell: (r) => (r.problems.length > 0 ? r.problems.join("; ") : "—"),
  },
  { key: "email", header: "Email", cell: (r) => <EmailBadge status={r.email} /> },
];

function ReportList() {
  const { params, set } = useHashQuery("laporan");
  const paging = usePaging(params, set);
  const sp = new URLSearchParams({ page: String(paging.page), pageSize: String(paging.pageSize) });
  const reports = useQuery({
    queryKey: ["accuracy-reports", sp.toString()],
    queryFn: () => get<Paged<"reports", AccuracyReportSummary>>(`/api/admin/accuracy?${sp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(reports.data?.total, paging, !reports.isPlaceholderData);
  const open = (date: string) => set({ date });

  return (
    <SectionCard title="Laporan akurasi harian" flush>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Dibuat otomatis tiap pukul 07.00 WIB untuk hari sebelumnya. Saran di dalamnya hanya saran; tidak ada yang diubah otomatis.
      </p>
      <QueryBoundary
        query={reports}
        isEmpty={(d) => d.reports.length === 0}
        empty={{ icon: FileText, title: "Belum ada laporan", description: "Laporan pertama muncul setelah pekerjaan harian jalan." }}
      >
        {(d) => (
          <>
            <DataList
              rows={d.reports}
              rowKey={(r) => r.date}
              columns={LIST_COLUMNS(open)}
              onRowClick={(r) => open(r.date)}
              rowLabel={(r) => `Buka laporan ${dayLabel(r.date)}`}
              switchAt="5xl"
              card={(r) => (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{dayLabel(r.date)}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <RegressionBadge row={r} />
                      <EmailBadge status={r.email} />
                    </span>
                  </div>
                  <p className="mt-1.5 text-2xl font-bold tabular-nums">
                    {pct(r.accurateRate)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">tanpa koreksi, 7 hari {pct(r.weekRate)}</span>
                  </p>
                  {r.problems.length > 0 && <p className="mt-1.5 text-xs break-words">{r.problems.join("; ")}</p>}
                  <CardFacts
                    facts={[
                      { label: "Scan", value: fmtNum(r.total) },
                      { label: "Dikoreksi", value: fmtNum(r.outcomes.corrected) },
                      { label: "Hitung ulang", value: fmtNum(r.outcomes.retried) },
                      { label: "Penilaian", value: fmtNum(r.ratings) },
                    ]}
                  />
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
  );
}

const STAGE_LABEL = {
  receiveMs: "Terima foto",
  quotaMs: "Cek kuota",
  ttftMs: "Token pertama",
  aiMs: "Model AI",
  totalMs: "Total di server",
} as const;

const OUTCOME_LABEL = {
  accurate: "Tanpa koreksi",
  corrected: "Dikoreksi",
  retried: "Hitung ulang",
  abandoned: "Ditinggal",
  pending: "Menunggu",
} as const;

const TOPIC_LABEL = { alias: "Alias", grams: "Gram", missed: "Terlewat", false_item: "Salah tambah" } as const;

/** Name/count rows of a top list, or a one-line empty note. */
function CountTable({ head, rows, empty }: { head: [string, string]; rows: Array<[string, number]>; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <StatTable head={head}>
      {rows.map(([name, n]) => (
        <tr key={name}>
          <td className="break-words font-medium">{name}</td>
          <td className={num}>{fmtNum(n)}</td>
        </tr>
      ))}
    </StatTable>
  );
}

function Detail({ report }: { report: AccuracyReport }) {
  const { scans, ratings, dishes, bias, health, latency, corrections, regression } = report;
  const o = scans.outcomes;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Scan"
          value={fmtNum(scans.total)}
          hint={
            scans.labelled > 0
              ? `${fmtNum(scans.labelled)} berlabel, ${fmtNum(scans.resolved)} selesai, ${fmtNum(o.abandoned)} ditinggal`
              : "belum ada yang berlabel (sebelum label koreksi dicatat)"
          }
        />
        <StatCard
          label="Tanpa koreksi"
          value={pct(scans.accurateRate)}
          hint={`${fmtNum(o.accurate)} dari ${fmtNum(scans.resolved)} scan selesai`}
        />
        <StatCard label="Rata-rata 7 hari" value={pct(scans.weekRate)} hint="tanpa koreksi" />
        <StatCard
          label="Gagal"
          value={fmtNum(health.failed.total)}
          hint={`${fmtNum(health.tooMany)} terlalu banyak, ${fmtNum(health.repaired)} JSON diperbaiki`}
        />
      </div>

      <SectionCard title="Regresi (foto berlabel dijalankan ulang)" flush>
        {!regression || regression.error ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Uji regresi tidak jalan{regression?.error ? `: ${regression.error}` : "."}
          </p>
        ) : regression.summary.cases + regression.summary.failed === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Belum ada foto berlabel untuk diuji (dataset pemilik atau foto feedback yang diizinkan).
          </p>
        ) : (
          <>
            {regression.flags.length > 0 ? (
              <ul className="flex flex-col gap-1.5 px-4 py-3 text-sm">
                {regression.flags.map((flag) => (
                  <li key={flag} className="flex gap-2">
                    <Badge tone="red">Regresi</Badge>
                    <span className="min-w-0 break-words">{flag}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm">
                <Badge tone="green">Aman</Badge>{" "}
                <span className="text-muted-foreground">
                  {regression.comparison
                    ? `dibanding ${dayLabel(regression.comparison.prevDate)} (${regression.comparison.common} foto sama)`
                    : "belum ada hari pembanding dengan cukup foto sama"}
                </span>
              </p>
            )}
            <StatTable head={["Ukuran", "Hari ini", "Pembanding"]}>
              <tr>
                <td>Foto dijalankan</td>
                <td className={num}>
                  {fmtNum(regression.summary.cases)}
                  {regression.summary.failed > 0 ? ` (+${regression.summary.failed} gagal)` : ""}
                </td>
                <td className={num}>maks {fmtNum(regression.cap)} / dari {fmtNum(regression.candidates)}</td>
              </tr>
              <tr>
                <td>Nama cocok (F1)</td>
                <td className={`${num} font-semibold`}>{pct(regression.summary.f1)}</td>
                <td className={num}>{regression.comparison ? pct(regression.comparison.f1Prev) : "—"}</td>
              </tr>
              <tr>
                <td>Kalori kurang (rata-rata)</td>
                <td className={`${num} font-semibold`}>
                  {regression.summary.shortfallPct === null ? "—" : `${regression.summary.shortfallPct}%`}
                </td>
                <td className={num}>{regression.comparison ? `${regression.comparison.shortfallPrev}%` : "—"}</td>
              </tr>
              <tr>
                <td>Selisih kalori (bertanda)</td>
                <td className={num}>{signedPct(regression.summary.signedPct)}</td>
                <td className={num}>—</td>
              </tr>
              <tr>
                <td>Waktu p50 / p95</td>
                <td className={num}>
                  {secs(regression.summary.p50Ms)} / {secs(regression.summary.p95Ms)}
                </td>
                <td className={num}>—</td>
              </tr>
            </StatTable>
          </>
        )}
      </SectionCard>

      <SectionCard title="Masalah teratas" flush>
        {report.problems.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Tidak ada koreksi dish hari ini.</p>
        ) : (
          <ol className="list-decimal px-8 py-3 text-sm leading-relaxed">
            {report.problems.map((problem) => (
              <li key={problem.text} className="break-words">
                {problem.text}
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <SectionCard title="Hasil scan hari ini">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(OUTCOME_LABEL) as Array<keyof typeof OUTCOME_LABEL>).map((key) => (
            <Badge key={key} tone={key === "accurate" ? "green" : key === "corrected" || key === "retried" ? "amber" : "muted"}>
              {OUTCOME_LABEL[key]} {fmtNum(o[key])}
            </Badge>
          ))}
        </div>
        <p className="mt-3 mb-2 text-xs text-muted-foreground">Tanpa koreksi per hari, 7 hari terakhir (%)</p>
        <DayBars
          rows={scans.trend
            .slice()
            .reverse()
            .map((day) => ({
              key: day.day,
              label: dayLabel(day.day),
              value: day.rate === null ? 0 : Math.round(day.rate * 100),
            }))}
          formatValue={(v) => `${v}%`}
        />
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Salah nama (AI → disimpan)" flush>
          <CountTable
            head={["Pasangan", "Scan"]}
            rows={dishes.renames.map((r) => [`${r.from} → ${r.to}`, r.n])}
            empty="Tidak ada."
          />
        </SectionCard>
        <SectionCard title="Paling sering dihapus" flush>
          <CountTable head={["Item", "Scan"]} rows={dishes.removed.map((r) => [r.name, r.n])} empty="Tidak ada." />
        </SectionCard>
        <SectionCard title="Paling sering terlewat (ditambah)" flush>
          <CountTable head={["Item", "Scan"]} rows={dishes.added.map((r) => [r.name, r.n])} empty="Tidak ada." />
        </SectionCard>
      </div>

      <SectionCard title="Bias gram dan kalori per dish (scan dikoreksi)" flush>
        {bias.dishes.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Belum ada angka yang dikoreksi.</p>
        ) : (
          <>
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Plus = AI kelewat tinggi, minus = kelewat rendah. Plat penuh: {fmtNum(bias.kcal.n)} scan, {fmtNum(bias.kcal.over)} terlalu tinggi,{" "}
              {fmtNum(bias.kcal.under)} terlalu rendah, rata-rata {signedPct(bias.kcal.meanPct)}.
            </p>
            <StatTable head={["Dish", "Scan", "Tinggi", "Rendah", "Gram", "Kalori"]}>
              {bias.dishes.map((d) => (
                <tr key={d.name}>
                  <td className="break-words font-medium">{d.name}</td>
                  <td className={num}>{fmtNum(d.n)}</td>
                  <td className={num}>{fmtNum(d.over)}</td>
                  <td className={num}>{fmtNum(d.under)}</td>
                  <td className={`${num} font-semibold`}>{signedPct(d.gramsPct)}</td>
                  <td className={num}>{signedPct(d.kcalPct)}</td>
                </tr>
              ))}
            </StatTable>
          </>
        )}
      </SectionCard>

      <SectionCard title="Penilaian pengguna">
        {ratings.total === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada penilaian.</p>
        ) : (
          <p className="text-sm">
            {fmtNum(ratings.total)} penilaian: {fmtNum(ratings.akurat)} akurat, {fmtNum(ratings.kurang)} kurang akurat, {fmtNum(ratings.salah)} salah.
          </p>
        )}
        {ratings.retryTaps > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{fmtNum(ratings.retryTaps)} tombol Hitung ulang lama (bukan penilaian).</p>
        )}
        {ratings.notes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {ratings.notes.map((n, i) => (
              <li key={i} className="rounded-lg bg-muted/50 p-2.5 break-words">
                <Badge tone={n.rating === "salah" ? "red" : n.rating === "akurat" ? "green" : "amber"}>{n.rating.replace("_", " ")}</Badge>{" "}
                {n.note}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Kecepatan dan koreksi" flush>
        <StatTable head={["Tahap", "Scan", "p50", "p95"]}>
          {(Object.keys(STAGE_LABEL) as Array<keyof typeof STAGE_LABEL>).map((key) => (
            <tr key={key}>
              <td>{STAGE_LABEL[key]}</td>
              <td className={num}>{fmtNum(latency[key].n)}</td>
              <td className={num}>{secs(latency[key].p50)}</td>
              <td className={`${num} font-semibold`}>{secs(latency[key].p95)}</td>
            </tr>
          ))}
        </StatTable>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Koreksi ketik/suara: {fmtNum(corrections.used)} dipakai, {fmtNum(corrections.failed)} gagal, {fmtNum(corrections.sessions)} scan terkoreksi.
          {health.failed.total > 0 &&
            ` Gagal: ${Object.entries(health.failed.byReason)
              .map(([reason, n]) => `${reason} ${n}`)
              .join(", ")}.`}
        </p>
      </SectionCard>

      <SectionCard title="Saran (tidak diterapkan otomatis)" flush>
        {report.suggestions.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Belum ada saran: datanya belum cukup.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {report.suggestions.map((s) => (
              <li key={s.text} className="px-4 py-2.5">
                <Badge>{TOPIC_LABEL[s.kind]}</Badge> <span className="font-medium break-words">{s.text}</span>
                <div className="mt-0.5 text-xs text-muted-foreground break-words">{s.evidence}</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function ReportDetail({ date, onBack }: { date: string; onBack: () => void }) {
  const report = useQuery({
    queryKey: ["accuracy-report", date],
    queryFn: () => get<AccuracyReport>(`/api/admin/accuracy/${date}`),
  });
  const body: ReactNode = (
    <QueryBoundary
      query={report}
      skeletonRows={4}
      isEmpty={() => false}
      empty={{ title: "Laporan tidak ditemukan" }}
    >
      {(r) => (
        <>
          <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <EmailBadge status={r.email?.status ?? null} />
            <span>dibuat {fmtDateTime(r.generatedAt)}</span>
          </p>
          <Detail report={r} />
        </>
      )}
    </QueryBoundary>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Semua laporan
        </Button>
        <h2 className="text-base font-semibold">{dayLabel(date)}</h2>
      </div>
      {body}
    </div>
  );
}

/** Laporan: the daily accuracy reports, list and detail, in the URL hash (#laporan?date=YYYY-MM-DD). */
export function LaporanSection() {
  const { params, set } = useHashQuery("laporan");
  const date = params.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return <ReportDetail date={date} onBack={() => set({ date: null })} />;
  }
  return <ReportList />;
}
