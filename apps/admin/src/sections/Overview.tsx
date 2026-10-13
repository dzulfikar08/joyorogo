import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@joyorogo/ui/components/button";
import { api, fmtIdr, get, type Overview, type UsageDay } from "../api";
import { BarChart, SectionCard, StatCard } from "../ui";

export function SendTestEmailButton() {
  const [sending, setSending] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={sending}
      onClick={async () => {
        setSending(true);
        try {
          const res = await api<{ outcome: string }>("/api/admin/test-email", { method: "POST" });
          if (res.outcome === "sent") toast.success(res.outcome);
          else toast.error(res.outcome);
        } catch (err) {
          toast.error(String(err));
        } finally {
          setSending(false);
        }
      }}
    >
      {sending ? "Sending…" : "Send test email"}
    </Button>
  );
}

/** Local-time YYYY-MM-DD keys for the last `n` days, oldest first. */
function lastDays(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return keys;
}

const dayLabel = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
const compactIdr = (v: number) =>
  new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v);

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

  // Continuous 30-day x-axis: server days may have gaps; missing days count 0.
  const days = useMemo(() => {
    const byDay: Record<string, UsageDay> = {};
    for (const d of usage.data?.days ?? []) byDay[d.day] = d;
    return lastDays(30).map(
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Users"
          value={o?.users ?? "…"}
          hint={o ? `${o.onboarded} onboarded` : undefined}
        />
        <StatCard
          label="Signups today"
          value={o?.signupsToday ?? "…"}
          hint={`7d: ${o?.signups7d ?? "…"}`}
        />
        <StatCard label="Active today" value={o?.activeToday ?? "…"} />
        <StatCard label="Founders" value={o?.founders ?? "…"} />
        <StatCard
          label="Scans today"
          value={o?.scansToday ?? "…"}
          hint={`7d: ${o?.scans7d ?? "…"} · anon: ${o?.anonScansToday ?? "…"}`}
        />
        <StatCard
          label="Revenue"
          value={fmtIdr(o?.revenueIdr)}
          hint={`${o?.paidOrders ?? "…"} paid · ${o?.pendingOrders ?? "…"} pending`}
        />
      </div>

      <SectionCard title="Last 30 days — scans per day">
        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            <BarChart
              rows={days.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.scans }))}
            />
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Last 30 days — signups per day">
          <div className="overflow-x-auto">
            <div className="min-w-[380px]">
              <BarChart
                height={100}
                rows={days.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.signups }))}
              />
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Last 30 days — revenue per day">
          <div className="overflow-x-auto">
            <div className="min-w-[380px]">
              <BarChart
                height={100}
                formatValue={compactIdr}
                rows={days.map((d) => ({
                  key: d.day,
                  label: dayLabel(d.day),
                  value: d.revenueIdr,
                }))}
              />
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Daily usage">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Scans</th>
                <th>Scan users</th>
                <th>Signups</th>
                <th>Paid</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {activeDays.map((d) => (
                <tr key={d.day}>
                  <td className="font-medium">{d.day}</td>
                  <td>{d.scans}</td>
                  <td>{d.scanUsers}</td>
                  <td>{d.signups}</td>
                  <td>{d.paid}</td>
                  <td>{fmtIdr(d.revenueIdr)}</td>
                </tr>
              ))}
              {activeDays.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground">
                    No activity in the last 30 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
