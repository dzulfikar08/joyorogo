import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { fmtDate, fmtDateTime, get, type AdminUser, type PagedUsers } from "../api";
import { useHashQuery } from "../hash";
import { Badge, Pagination } from "../ui";
import { UserDetail } from "./UserDetail";

function TierBadge({ user }: { user: AdminUser }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Badge tone={user.tier === "founder" ? "green" : "muted"}>
        {user.tier === "founder" ? "Founder" : "Free"}
      </Badge>
      {user.manualTier === "founder" && <Badge tone="amber">comp</Badge>}
      {user.aiUnlimited && <Badge tone="amber">AI unlimited</Badge>}
    </span>
  );
}

type SortKey = "newest" | "lastSeen" | "scansToday" | "scans7d" | "scansTotal";
const SELECT_CLS = "h-12 rounded-xl border border-border bg-card px-3 text-sm text-foreground";

export function UsersSection() {
  const { params, set } = useHashQuery("users");
  const q = params.get("q") ?? "";
  const tier = params.get("tier") ?? "";
  const abuse = params.get("abuse") === "1";
  const sort = (params.get("sort") ?? "scans7d") as SortKey;
  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("pageSize") ?? 50) || 50;
  const [search, setSearch] = useState(q);
  const [openId, setOpenId] = useState<string | null>(null);

  // Debounce the search box into the hash param so reloads keep state.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) set({ q: search || null, page: null });
    }, 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const sp = new URLSearchParams({ sort, page: String(page), pageSize: String(pageSize) });
  if (q.trim()) sp.set("q", q.trim());
  if (tier) sp.set("tier", tier);
  if (abuse) sp.set("abuse", "1");

  const users = useQuery({
    queryKey: ["users", sp.toString()],
    queryFn: () => get<PagedUsers>(`/api/admin/users?${sp}`),
    placeholderData: keepPreviousData,
  });

  const rows = users.data?.users ?? [];
  const setFilter = (patch: Record<string, string | number | null>) => set({ ...patch, page: null });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau email…"
            className="pl-10"
          />
        </div>
        <select
          value={tier}
          onChange={(e) => setFilter({ tier: e.target.value || null })}
          className={SELECT_CLS}
        >
          <option value="">Tier: semua</option>
          <option value="free">Tier: free</option>
          <option value="founder">Tier: founder</option>
        </select>
        <label className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={abuse}
            onChange={(e) => setFilter({ abuse: e.target.checked ? "1" : null })}
            className="size-4 accent-primary"
          />
          Dugaan abuse
        </label>
        <select
          value={sort}
          onChange={(e) => setFilter({ sort: e.target.value })}
          className={SELECT_CLS}
        >
          <option value="scans7d">Sort: scans 7d</option>
          <option value="scansToday">Sort: scans today</option>
          <option value="scansTotal">Sort: scans total</option>
          <option value="lastSeen">Sort: last seen</option>
          <option value="newest">Sort: newest</option>
        </select>
      </div>

      <div className={cn("rounded-xl border border-border bg-card", users.isPlaceholderData && "opacity-60")}>
        {users.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : users.isError ? (
          <p className="p-4 text-sm text-destructive">{String(users.error)}</p>
        ) : (
          <>
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
                        {u.tier === "founder" && u.manualTier !== "founder" && u.founderUntil !== null && (
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
            <div className="p-3">
              <Pagination
                page={users.data.page}
                pageSize={users.data.pageSize}
                total={users.data.total}
                onPage={(p) => set({ page: p === 1 ? null : p })}
                onPageSize={(s) => set({ pageSize: s === 50 ? null : s, page: null })}
              />
            </div>
          </>
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
