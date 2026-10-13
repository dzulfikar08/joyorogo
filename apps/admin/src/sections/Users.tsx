import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@joyorogo/ui/components/input";
import { fmtDate, fmtDateTime, get, type AdminUser } from "../api";
import { Badge } from "../ui";
import { UserDetail } from "./UserDetail";

function TierBadge({ user }: { user: AdminUser }) {
  if (user.tier === "founder") {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <Badge tone="green">Founder</Badge>
        {user.aiUnlimited && <Badge tone="amber">AI unlimited</Badge>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Badge>Free</Badge>
      {user.aiUnlimited && <Badge tone="amber">AI unlimited</Badge>}
    </span>
  );
}

type SortKey = "name" | "scansToday" | "scans7d" | "scansTotal" | "createdAt";

export function UsersSection() {
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => get<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("scans7d");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users.data?.users ?? [])
      .filter(
        (u) =>
          !needle ||
          u.email.toLowerCase().includes(needle) ||
          (u.name ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === "name") {
          return (a.name ?? a.email).localeCompare(b.name ?? b.email);
        }
        if (sort === "createdAt") {
          return Number(new Date(b.createdAt)) - Number(new Date(a.createdAt));
        }
        return b[sort] - a[sort];
      });
  }, [users.data, q, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau email…"
            className="pl-10"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-12 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="scans7d">Sort: scans 7d</option>
          <option value="scansToday">Sort: scans today</option>
          <option value="scansTotal">Sort: scans total</option>
          <option value="createdAt">Sort: newest</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {users.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : users.isError ? (
          <p className="p-4 text-sm text-destructive">{String(users.error)}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Tier</th>
                  <th>Onboarded</th>
                  <th>Scans today</th>
                  <th>Scans 7d</th>
                  <th>Scans total</th>
                  <th>Food logs</th>
                  <th>Last seen</th>
                  <th>Created</th>
                  <th>Orders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="cursor-pointer" onClick={() => setOpenId(u.id)}>
                    <td>
                      <div className="font-medium">{u.name ?? "—"}</div>
                      <div className="text-muted-foreground">{u.email}</div>
                    </td>
                    <td>
                      <TierBadge user={u} />
                      {u.tier === "founder" && u.founderUntil !== null && (
                        <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                          until {fmtDate(u.founderUntil)}
                        </div>
                      )}
                    </td>
                    <td>{u.onboarded ? "✓" : "—"}</td>
                    <td className="tabular-nums">
                      {u.scansToday >= 50 || u.scans7d >= 300 ? (
                        <Badge tone="red" className="tabular-nums">
                          {u.scansToday} ⚠
                        </Badge>
                      ) : (
                        u.scansToday
                      )}
                    </td>
                    <td className="tabular-nums">
                      {u.scans7d >= 300 ? (
                        <Badge tone="red" className="tabular-nums">
                          {u.scans7d} ⚠
                        </Badge>
                      ) : (
                        u.scans7d
                      )}
                    </td>
                    <td className="tabular-nums">{u.scansTotal}</td>
                    <td className="tabular-nums">{u.foodLogs}</td>
                    <td>{fmtDateTime(u.lastSeen)}</td>
                    <td>{fmtDate(u.createdAt)}</td>
                    <td className="tabular-nums">
                      {u.paidOrders} paid · {u.pendingOrders} pending
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-muted-foreground">
                      No users match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && (
        <UserDetail
          userId={openId}
          onClose={() => {
            setOpenId(null);
            void users.refetch();
          }}
        />
      )}
    </div>
  );
}
