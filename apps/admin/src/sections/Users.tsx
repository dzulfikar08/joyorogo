import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, SearchX, TriangleAlert } from "lucide-react";
import { Checkbox } from "@joyorogo/ui/components/checkbox";
import {
  fmtDate,
  fmtDateTime,
  fmtNum,
  get,
  type AdminUser,
  type PagedUsers,
} from "../api";
import { SERVER_URL } from "../auth-client";
import { useClampPage, useHashQuery, usePaging } from "../hash";
import {
  Badge,
  CardFacts,
  DataList,
  Pagination,
  QueryBoundary,
  SearchBox,
  Select,
  type Column,
} from "../ui";
import { UserDetail } from "./UserDetail";

// Same heuristics as the server (admin.ts ABUSE_TODAY / ABUSE_7D).
const ABUSE_TODAY = 50;
const ABUSE_7D = 300;

function TierBadge({ user }: { user: AdminUser }) {
  return (
    <span className="inline-flex flex-wrap items-start gap-1">
      <Badge tone={user.tier === "founder" ? "green" : "muted"}>
        {user.tier === "founder" ? "Founder" : "Free"}
      </Badge>
      {user.manualTier === "founder" && <Badge tone="amber">comp</Badge>}
      {user.aiUnlimited && <Badge tone="amber">AI unlimited</Badge>}
    </span>
  );
}

function Avatar({ user }: { user: AdminUser }) {
  return user.image ? (
    <img
      src={user.image.startsWith("/") ? `${SERVER_URL}${user.image}` : user.image}
      alt=""
      className="size-9 shrink-0 rounded-full object-cover md:size-6"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs text-muted-foreground md:size-6 md:text-[0.625rem]">
      {(user.name ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

/** Scan count, flagged red when it crosses the abuse threshold. */
function ScanCount({ value, flagAt }: { value: number; flagAt: number }) {
  return value >= flagAt ? (
    <Badge tone="red" className="tabular-nums">
      <TriangleAlert className="size-3" />
      {fmtNum(value)}
    </Badge>
  ) : (
    <>{fmtNum(value)}</>
  );
}

const founderUntilNote = (u: AdminUser) =>
  u.tier === "founder" && u.manualTier !== "founder" && u.founderUntil !== null
    ? `until ${fmtDate(u.founderUntil)}`
    : null;

const COLUMNS: Column<AdminUser>[] = [
  {
    key: "user",
    header: "User",
    cell: (u) => (
      <div className="flex items-center gap-2">
        <Avatar user={u} />
        <div className="min-w-0">
          <div className="font-medium">{u.name ?? "—"}</div>
          <div className="text-muted-foreground">{u.email}</div>
        </div>
      </div>
    ),
  },
  {
    key: "tier",
    header: "Tier",
    cell: (u) => (
      <>
        <TierBadge user={u} />
        {founderUntilNote(u) && (
          <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{founderUntilNote(u)}</div>
        )}
      </>
    ),
  },
  {
    key: "onboarded",
    header: "Onboarded",
    cell: (u) =>
      u.onboarded ? <Check aria-label="Onboarded" className="size-4 text-primary" /> : "—",
  },
  {
    key: "today",
    header: "Scans today",
    numeric: true,
    cell: (u) => (
      <ScanCount value={u.scansToday} flagAt={ABUSE_TODAY} />
    ),
  },
  {
    key: "7d",
    header: "Scans 7d",
    numeric: true,
    cell: (u) => <ScanCount value={u.scans7d} flagAt={ABUSE_7D} />,
  },
  { key: "total", header: "Scans total", numeric: true, cell: (u) => fmtNum(u.scansTotal) },
  { key: "food", header: "Food logs", numeric: true, cell: (u) => fmtNum(u.foodLogs) },
  { key: "seen", header: "Last seen", nowrap: true, cell: (u) => fmtDateTime(u.lastSeen) },
  { key: "created", header: "Created", nowrap: true, cell: (u) => fmtDate(u.createdAt) },
  {
    key: "orders",
    header: "Orders",
    nowrap: true,
    cell: (u) => `${fmtNum(u.paidOrders)} paid · ${fmtNum(u.pendingOrders)} pending`,
  },
];

function UserCard({ user: u }: { user: AdminUser }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar user={u} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{u.name ?? "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
        </div>
        <TierBadge user={u} />
      </div>
      <CardFacts
        facts={[
          {
            label: "Scans hari ini / 7d",
            value: (
              <>
                <ScanCount value={u.scansToday} flagAt={ABUSE_TODAY} /> /{" "}
                <ScanCount value={u.scans7d} flagAt={ABUSE_7D} />
              </>
            ),
          },
          { label: "Scans total", value: fmtNum(u.scansTotal) },
          { label: "Food logs", value: fmtNum(u.foodLogs) },
          { label: "Onboarded", value: u.onboarded ? "Ya" : "Belum" },
          { label: "Last seen", value: fmtDateTime(u.lastSeen) },
          { label: "Created", value: fmtDate(u.createdAt) },
          {
            label: "Orders",
            value: `${fmtNum(u.paidOrders)} paid · ${fmtNum(u.pendingOrders)} pending`,
          },
          ...(founderUntilNote(u) ? [{ label: "Founder", value: founderUntilNote(u) }] : []),
        ]}
      />
    </>
  );
}

type SortKey = "newest" | "lastSeen" | "scansToday" | "scans7d" | "scansTotal";
const SORTS: SortKey[] = ["scans7d", "scansToday", "scansTotal", "lastSeen", "newest"];

export function UsersSection() {
  const { params, set } = useHashQuery("users");
  const q = params.get("q") ?? "";
  const tier = params.get("tier") === "free" || params.get("tier") === "founder" ? params.get("tier")! : "";
  const abuse = params.get("abuse") === "1";
  const sortParam = params.get("sort") as SortKey | null;
  const sort: SortKey = sortParam && SORTS.includes(sortParam) ? sortParam : "scans7d";
  const paging = usePaging(params, set);
  const openId = params.get("user");

  const sp = new URLSearchParams({
    sort,
    page: String(paging.page),
    pageSize: String(paging.pageSize),
  });
  if (q) sp.set("q", q);
  if (tier) sp.set("tier", tier);
  if (abuse) sp.set("abuse", "1");

  const users = useQuery({
    queryKey: ["users", sp.toString()],
    queryFn: () => get<PagedUsers>(`/api/admin/users?${sp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(users.data?.total, paging, !users.isPlaceholderData);

  const setFilter = (patch: Record<string, string | number | null>) =>
    set({ ...patch, page: null });
  const filtered = Boolean(q || tier || abuse);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={q}
          onSearch={(v) => set({ q: v || null, page: null }, { replace: true })}
          placeholder="Cari nama atau email…"
          label="Cari user"
        />
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Select
            value={tier}
            onValueChange={(v) => setFilter({ tier: v || null })}
            aria-label="Filter tier"
            options={[
              { value: "", label: "Tier: semua" },
              { value: "free", label: "Tier: free" },
              { value: "founder", label: "Tier: founder" },
            ]}
          />
          <Select
            value={sort}
            onValueChange={(v) => setFilter({ sort: v === "scans7d" ? null : v })}
            aria-label="Urutkan"
            options={[
              { value: "scans7d", label: "Sort: scans 7d" },
              { value: "scansToday", label: "Sort: scans today" },
              { value: "scansTotal", label: "Sort: scans total" },
              { value: "lastSeen", label: "Sort: last seen" },
              { value: "newest", label: "Sort: newest" },
            ]}
          />
          <label className="col-span-2 inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-muted px-3 text-base text-foreground">
            <Checkbox
              checked={abuse}
              onCheckedChange={(checked) => setFilter({ abuse: checked ? "1" : null })}
            />
            Dugaan abuse
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <QueryBoundary
          query={users}
          isEmpty={(d) => d.users.length === 0}
          empty={{
            icon: SearchX,
            title: "Tidak ada user",
            description: filtered ? "Tidak ada yang cocok dengan pencarian atau filter ini." : undefined,
          }}
        >
          {(d) => (
            <>
              <DataList
                rows={d.users}
                rowKey={(u) => u.id}
                columns={COLUMNS}
                card={(u) => <UserCard user={u} />}
                onRowClick={(u) => set({ user: u.id })}
                rowLabel={(u) => `Buka detail ${u.name ?? u.email}`}
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
      </div>

      {openId && (
        <UserDetail
          userId={openId}
          onClose={() => {
            set({
              user: null,
              callsPage: null,
              foodsPage: null,
              ordersPage: null,
              sessionsPage: null,
              detailSize: null,
            });
            void users.refetch();
          }}
        />
      )}
    </div>
  );
}
