import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CalendarX, RotateCw, TriangleAlert } from "lucide-react";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import {
  errorMessage,
  fmtCompact,
  fmtIdr,
  fmtNum,
  get,
  lastWibDays,
  type Overview,
  type UsageDay,
} from "../api";
import {
  BarChart,
  Button,
  CardFacts,
  DataList,
  QueryBoundary,
  SectionCard,
  StatCard,
  type Column,
} from "../ui";

const dayLabel = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;

const DAY_COLUMNS: Column<UsageDay>[] = [
  { key: "day", header: "Day", cell: (d) => d.day, className: "font-medium" },
  { key: "scans", header: "Scans", numeric: true, cell: (d) => fmtNum(d.scans) },
  { key: "scanUsers", header: "Scan users", numeric: true, cell: (d) => fmtNum(d.scanUsers) },
  { key: "signups", header: "Signups", numeric: true, cell: (d) => fmtNum(d.signups) },
  { key: "paid", header: "Paid", numeric: true, cell: (d) => fmtNum(d.paid) },
  { key: "revenue", header: "Revenue", numeric: true, cell: (d) => fmtIdr(d.revenueIdr) },
];

export function OverviewSection() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: () => get<Overview>("/api/admin/overview"),
  });
  const usage = useQuery({
    queryKey: ["usage", 30],
    queryFn: () => get<{ days: UsageDay[] }>("/api/admin/usage?days=30"),
  });

  const o = overview.data;
  const stat = (value: string | number | undefined) =>
    value === undefined ? <Skeleton className="mt-1 h-7 w-16" /> : typeof value === "number" ? fmtNum(value) : value;
  const hint = (text: string | undefined) => (o ? text : undefined);

  // Continuous 30-day x-axis (WIB days, like the server): missing days count 0.
  const days = useMemo(() => {
    const byDay: Record<string, UsageDay> = {};
    for (const d of usage.data?.days ?? []) byDay[d.day] = d;
    return lastWibDays(30).map(
      (day) => byDay[day] ?? { day, scans: 0, scanUsers: 0, signups: 0, paid: 0, revenueIdr: 0 },
    );
  }, [usage.data]);

  // Table: newest first, only days with any activity.
  const activeDays = useMemo(
    () =>
      [...days]
        .reverse()
        .filter((d) => d.scans > 0 || d.signups > 0 || d.paid > 0 || d.revenueIdr > 0),
    [days],
  );

  return (
    <div className="flex flex-col gap-4">
      {overview.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            Gagal memuat ringkasan: {errorMessage(overview.error)}
          </span>
          <Button size="sm" variant="outline" onClick={() => void overview.refetch()}>
            <RotateCw className="size-4" />
            Coba lagi
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Users"
          value={stat(o?.users)}
          hint={hint(o && `${fmtNum(o.onboarded)} onboarded`)}
        />
        <StatCard
          label="Signups today"
          value={stat(o?.signupsToday)}
          hint={hint(o && `7d: ${fmtNum(o.signups7d)}`)}
        />
        <StatCard label="Active today" value={stat(o?.activeToday)} />
        <StatCard label="Founders" value={stat(o?.founders)} />
        <StatCard
          label="Scans today"
          value={stat(o?.scansToday)}
          hint={hint(o && `7d: ${fmtNum(o.scans7d)} · anon: ${fmtNum(o.anonScansToday)}`)}
        />
        <StatCard
          label="Revenue"
          value={stat(o ? fmtIdr(o.revenueIdr) : undefined)}
          hint={hint(o && `${fmtNum(o.paidOrders)} paid · ${fmtNum(o.pendingOrders)} pending`)}
        />
      </div>

      <SectionCard title="Last 30 days — scans per day">
        <QueryBoundary
          query={usage}
          skeletonRows={2}
          isEmpty={() => false}
          empty={{ title: "" }}
        >
          {() => (
            <BarChart
              formatValue={fmtNum}
              rows={days.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.scans }))}
            />
          )}
        </QueryBoundary>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Last 30 days — signups per day">
          <QueryBoundary query={usage} skeletonRows={2} isEmpty={() => false} empty={{ title: "" }}>
            {() => (
              <BarChart
                height={100}
                formatValue={fmtNum}
                rows={days.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.signups }))}
              />
            )}
          </QueryBoundary>
        </SectionCard>
        <SectionCard title="Last 30 days — revenue per day">
          <QueryBoundary query={usage} skeletonRows={2} isEmpty={() => false} empty={{ title: "" }}>
            {() => (
              <BarChart
                height={100}
                formatValue={fmtCompact}
                rows={days.map((d) => ({
                  key: d.day,
                  label: dayLabel(d.day),
                  value: d.revenueIdr,
                }))}
              />
            )}
          </QueryBoundary>
        </SectionCard>
      </div>

      <SectionCard title="Daily usage" flush>
        <QueryBoundary
          query={usage}
          skeletonRows={3}
          isEmpty={() => activeDays.length === 0}
          empty={{ icon: CalendarX, title: "Belum ada aktivitas", description: "Tidak ada aktivitas dalam 30 hari terakhir." }}
        >
          {() => (
            <DataList
              rows={activeDays}
              rowKey={(d) => d.day}
              columns={DAY_COLUMNS}
              switchAt="xl"
              card={(d) => (
                <>
                  <div className="text-sm font-medium">{d.day}</div>
                  <CardFacts
                    facts={[
                      { label: "Scans", value: fmtNum(d.scans) },
                      { label: "Scan users", value: fmtNum(d.scanUsers) },
                      { label: "Signups", value: fmtNum(d.signups) },
                      { label: "Paid", value: fmtNum(d.paid) },
                      { label: "Revenue", value: fmtIdr(d.revenueIdr) },
                    ]}
                  />
                </>
              )}
            />
          )}
        </QueryBoundary>
      </SectionCard>
    </div>
  );
}
