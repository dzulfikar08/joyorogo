import { useQuery } from "@tanstack/react-query";
import { fmtIdr, get, type Overview, type UsageDay } from "../api";
import { DayBars, SectionCard, StatCard } from "../ui";

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
  const days = usage.data?.days ?? [];

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
        <DayBars
          rows={[...days].reverse().map((d) => ({
            key: d.day,
            label: d.day.slice(5),
            value: d.scans,
          }))}
        />
      </SectionCard>

      <SectionCard title="Last 30 days — daily usage">
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
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="font-medium">{d.day}</td>
                  <td>{d.scans}</td>
                  <td>{d.scanUsers}</td>
                  <td>{d.signups}</td>
                  <td>{d.paid}</td>
                  <td>{fmtIdr(d.revenueIdr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
