import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, SearchX, UserX } from "lucide-react";
import { Checkbox } from "@joyorogo/ui/components/checkbox";
import {
  fmtDate,
  fmtDateTime,
  fmtNum,
  get,
  type AdminUser,
  type PagedUsers,
  type Plan,
} from "../api";
import { SERVER_URL } from "../auth-client";
import { useClampPage, useHashQuery, usePaging } from "../hash";
import {
  ABUSE_7D,
  DayScans,
  LastScan,
  PlanBadge,
  ScanCount,
  Streak,
  founderUntilNote,
} from "../scan-parts";
import {
  Button,
  CardFacts,
  DataList,
  Pagination,
  QueryBoundary,
  SearchBox,
  Select,
  type Column,
  type ListSort,
} from "../ui";
import { UserDetail } from "./UserDetail";

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
    key: "plan",
    header: "Plan",
    cell: (u) => (
      <>
        <PlanBadge user={u} />
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
    key: "yesterday",
    header: "Scans yesterday",
    numeric: true,
    sortKey: "scansYesterday",
    cell: (u) => <DayScans value={u.scansYesterday} />,
  },
  {
    key: "today",
    header: "Scans today",
    numeric: true,
    sortKey: "scansToday",
    cell: (u) => <DayScans value={u.scansToday} />,
  },
  {
    key: "streak",
    header: "Streak",
    numeric: true,
    sortKey: "streak",
    cell: (u) => <Streak days={u.streak} />,
  },
  {
    key: "lastScan",
    header: "Last scan",
    nowrap: true,
    sortKey: "lastScan",
    cell: (u) => <LastScan user={u} />,
  },
  {
    key: "7d",
    header: "Scans 7d",
    numeric: true,
    sortKey: "scans7d",
    cell: (u) => <ScanCount value={u.scans7d} flagAt={ABUSE_7D} />,
  },
  {
    key: "total",
    header: "Scans total",
    numeric: true,
    sortKey: "scansTotal",
    cell: (u) => fmtNum(u.scansTotal),
  },
  { key: "food", header: "Food logs", numeric: true, cell: (u) => fmtNum(u.foodLogs) },
  {
    key: "seen",
    header: "Last seen",
    nowrap: true,
    sortKey: "lastSeen",
    cell: (u) => fmtDateTime(u.lastSeen),
  },
  {
    key: "created",
    header: "Created",
    nowrap: true,
    sortKey: "newest",
    cell: (u) => fmtDate(u.createdAt),
  },
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
        <PlanBadge user={u} />
      </div>
      <CardFacts
        facts={[
          {
            label: "Scans kemarin / hari ini",
            value: (
              <>
                <DayScans value={u.scansYesterday} /> / <DayScans value={u.scansToday} />
              </>
            ),
          },
          { label: "Streak", value: <Streak days={u.streak} /> },
          { label: "Scan terakhir", value: <LastScan user={u} /> },
          { label: "Scans 7d", value: <ScanCount value={u.scans7d} flagAt={ABUSE_7D} /> },
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

type SortKey =
  | "newest"
  | "lastSeen"
  | "scansToday"
  | "scansYesterday"
  | "scans7d"
  | "scansTotal"
  | "streak"
  | "lastScan";
const SORTS: SortKey[] = [
  "scans7d",
  "scansToday",
  "scansYesterday",
  "streak",
  "lastScan",
  "scansTotal",
  "lastSeen",
  "newest",
];
const DEFAULT_SORT: SortKey = "scans7d";

const PLANS: Plan[] = ["paid", "founder", "free"];
/** Server `idle` values: no scan today nor in the N days before. */
const IDLE_OPTIONS = [
  { value: "", label: "Tidak scan: semua" },
  { value: "1", label: "Tidak scan: kemarin & hari ini" },
  { value: "3", label: "Tidak scan: 3 hari + hari ini" },
  { value: "7", label: "Tidak scan: 7 hari + hari ini" },
];

export function UsersSection() {
  const { params, set } = useHashQuery("users");
  const q = params.get("q") ?? "";
  const planParam = params.get("plan");
  const plan = PLANS.find((p) => p === planParam) ?? "";
  const idleParam = params.get("idle");
  const idle = IDLE_OPTIONS.some((o) => o.value === idleParam) ? (idleParam ?? "") : "";
  const abuse = params.get("abuse") === "1";
  const sortParam = params.get("sort") as SortKey | null;
  const sort: SortKey = sortParam && SORTS.includes(sortParam) ? sortParam : DEFAULT_SORT;
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const paging = usePaging(params, set);
  const openId = params.get("user");

  const sp = new URLSearchParams({
    sort,
    dir,
    page: String(paging.page),
    pageSize: String(paging.pageSize),
  });
  if (q) sp.set("q", q);
  if (plan) sp.set("plan", plan);
  if (idle) sp.set("idle", idle);
  if (abuse) sp.set("abuse", "1");

  const users = useQuery({
    queryKey: ["users", sp.toString()],
    queryFn: () => get<PagedUsers>(`/api/admin/users?${sp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(users.data?.total, paging, !users.isPlaceholderData);

  const setFilter = (patch: Record<string, string | number | null>) =>
    set({ ...patch, page: null });
  const filtered = Boolean(q || plan || idle || abuse);

  // Defaults stay out of the URL.
  const setSort = (key: SortKey, nextDir: "asc" | "desc") =>
    setFilter({ sort: key === DEFAULT_SORT ? null : key, dir: nextDir === "desc" ? null : nextDir });
  const listSort: ListSort = {
    key: sort,
    dir,
    onSort: (key) => {
      const next = key as SortKey;
      setSort(next, next === sort && dir === "desc" ? "asc" : "desc");
    },
  };

  // "Paid, not scanning" / "Free, not scanning": the plan + an idle window (1 = yesterday and today).
  const quick = (target: Plan, label: string) => {
    const active = plan === target && idle !== "";
    return (
      <Button
        size="sm"
        variant={active ? "default" : "outline"}
        aria-pressed={active}
        onClick={() =>
          setFilter(active ? { plan: null, idle: null } : { plan: target, idle: idle || "1" })
        }
      >
        <UserX />
        {label}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={q}
          onSearch={(v) => set({ q: v || null, page: null }, { replace: true })}
          placeholder="Cari nama atau email…"
          label="Cari user"
        />
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Select
            value={plan}
            onValueChange={(v) => setFilter({ plan: v || null })}
            aria-label="Filter plan"
            options={[
              { value: "", label: "Plan: semua" },
              { value: "paid", label: "Plan: paid" },
              { value: "founder", label: "Plan: founder (comp)" },
              { value: "free", label: "Plan: free" },
            ]}
          />
          <Select
            value={idle}
            onValueChange={(v) => setFilter({ idle: v || null })}
            aria-label="Filter tidak scan"
            options={IDLE_OPTIONS}
          />
          <Select
            value={sort}
            onValueChange={(v) => setSort(v as SortKey, dir)}
            aria-label="Urutkan"
            options={[
              { value: "scans7d", label: "Sort: scans 7d" },
              { value: "scansToday", label: "Sort: scans today" },
              { value: "scansYesterday", label: "Sort: scans yesterday" },
              { value: "streak", label: "Sort: streak" },
              { value: "lastScan", label: "Sort: last scan" },
              { value: "scansTotal", label: "Sort: scans total" },
              { value: "lastSeen", label: "Sort: last seen" },
              { value: "newest", label: "Sort: newest" },
            ]}
          />
          <Button
            variant="secondary"
            className="h-12 rounded-xl"
            aria-label={dir === "desc" ? "Urutan terbesar dulu" : "Urutan terkecil dulu"}
            onClick={() => setSort(sort, dir === "desc" ? "asc" : "desc")}
          >
            {dir === "desc" ? <ArrowDown /> : <ArrowUp />}
            {dir === "desc" ? "Terbesar dulu" : "Terkecil dulu"}
          </Button>
          <label className="col-span-2 inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-muted px-3 text-base text-foreground">
            <Checkbox
              checked={abuse}
              onCheckedChange={(checked) => setFilter({ abuse: checked ? "1" : null })}
            />
            Dugaan abuse
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {quick("paid", "Paid, tidak scan")}
        {quick("free", "Free, tidak scan")}
        <span className="text-xs text-muted-foreground">
          Jendela mengikuti filter “Tidak scan” (default kemarin & hari ini); hari = WIB.
        </span>
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
                sort={listSort}
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
