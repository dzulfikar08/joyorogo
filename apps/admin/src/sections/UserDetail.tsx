import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox, TriangleAlert, UserX } from "lucide-react";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import {
  ApiError,
  api,
  errorMessage,
  fmtDate,
  fmtDateTime,
  fmtNum,
  get,
  chargedLabel,
  orderMethod,
  toDate,
  type AdminSession,
  type AdminUser,
  type AiCall,
  type FoodLog,
  type Paged,
  type UserDetail as UserDetailData,
  type UserOrder,
} from "../api";
import { useClampPage, useHashQuery, usePaging } from "../hash";
import { DayScans, LastScan, PlanBadge, Streak, founderUntilNote } from "../scan-parts";
import { Amount, CheckOrderButton, OrderStatus } from "../order-parts";
import {
  Badge,
  CardFacts,
  ConfirmAction,
  CardList,
  BarChart,
  Pagination,
  QueryBoundary,
  SectionCard,
  StateMessage,
} from "../ui";

const MONTH = 30 * 24 * 60 * 60 * 1000;

function extendedFounderUntil(user: AdminUser): string {
  const current = toDate(user.founderUntil)?.getTime() ?? 0;
  return new Date(Math.max(Date.now(), current) + MONTH).toISOString();
}

/** Every tier mutation applies via PATCH, toasts the result. */
function useTierMutation(
  userId: string,
  patch: { tier?: "free" | "founder"; founderUntil?: string | null; aiUnlimited?: boolean },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/api/admin/users/${userId}`, {
        method: "PATCH",
        json: patch,
      }),
    onSuccess: () => {
      toast.success("Tersimpan.");
      void qc.invalidateQueries({ queryKey: ["user", userId] });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

function TierControls({ user }: { user: AdminUser }) {
  const m = (patch: Parameters<typeof useTierMutation>[1]) => useTierMutation(user.id, patch);

  const setFree = m({ tier: "free" });
  const setFounder = m({ tier: "founder" });
  const giveMonth = m({ tier: "founder", founderUntil: extendedFounderUntil(user) });
  const clearUntil = m({ founderUntil: null });
  const toggleUnlimited = m({ aiUnlimited: !user.aiUnlimited });

  const busy =
    setFree.isPending ||
    setFounder.isPending ||
    giveMonth.isPending ||
    clearUntil.isPending ||
    toggleUnlimited.isPending;

  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmAction
        trigger="Set Free"
        disabled={busy}
        destructive
        title="Jadikan user ini Free?"
        description="Tier diubah menjadi Free — akses Founder langsung hilang."
        onConfirm={() => setFree.mutate()}
      />
      <ConfirmAction
        trigger="Set Founder (comp)"
        disabled={busy}
        title="Jadikan Founder permanen (comp)?"
        description="User mendapat Founder tanpa batas waktu, tanpa pembayaran."
        onConfirm={() => setFounder.mutate()}
      />
      <ConfirmAction
        trigger="Founder +1 bulan"
        triggerVariant="default"
        disabled={busy}
        title="Beri / perpanjang Founder +1 bulan?"
        description={`Founder berbayar sampai ${fmtDate(extendedFounderUntil(user))} (dari ${fmtDate(user.founderUntil)}).`}
        onConfirm={() => giveMonth.mutate()}
      />
      <ConfirmAction
        trigger="Clear founderUntil"
        triggerVariant="ghost"
        disabled={busy}
        destructive
        title="Hapus tanggal habis Founder?"
        description="Tanggal habis dihapus; tier tetap seperti sekarang."
        onConfirm={() => clearUntil.mutate()}
      />
      <ConfirmAction
        trigger={`${user.aiUnlimited ? "Disable" : "Enable"} AI unlimited`}
        triggerVariant="ghost"
        disabled={busy}
        title={`Ubah AI unlimited menjadi ${user.aiUnlimited ? "nonaktif" : "aktif"}?`}
        description={
          user.aiUnlimited
            ? "Batas scan harian berlaku lagi untuk user ini."
            : "User bisa scan tanpa batas harian."
        }
        onConfirm={() => toggleUnlimited.mutate()}
      />
    </div>
  );
}

/**
 * One server-paged list inside the user sheet. Page state lives in the URL
 * (`<kind>Page`, shared `detailSize`) so a reload reopens the same page.
 */
function DetailList<K extends string, T>({
  kind,
  title,
  userId,
  card,
  rowKey,
  emptyTitle,
}: {
  kind: K;
  title: string;
  userId: string;
  card: (row: T) => React.ReactNode;
  rowKey: (row: T, index: number) => string;
  emptyTitle: string;
}) {
  const { params, set } = useHashQuery("users");
  const paging = usePaging(params, set, { page: `${kind}Page`, pageSize: "detailSize" });
  const sp = new URLSearchParams({
    page: String(paging.page),
    pageSize: String(paging.pageSize),
  });
  const list = useQuery({
    queryKey: ["user", userId, kind, sp.toString()],
    queryFn: () => get<Paged<K, T>>(`/api/admin/users/${userId}/${kind}?${sp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(list.data?.total, paging, !list.isPlaceholderData);

  return (
    <SectionCard
      flush
      title={
        <>
          {title}
          {list.data && (
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
              ({fmtNum(list.data.total)})
            </span>
          )}
        </>
      }
    >
      <QueryBoundary
        query={list}
        skeletonRows={3}
        isEmpty={(d) => d.total === 0}
        empty={{ icon: Inbox, title: emptyTitle }}
      >
        {(d) => (
          <>
            <CardList rows={d[kind]} rowKey={rowKey} card={card} />
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

export function UserDetail({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["user", userId],
    queryFn: () => get<UserDetailData>(`/api/admin/users/${userId}`),
  });
  const u = detail.data?.user;
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;
  const d = detail.data;
  const refreshUser = () => void qc.invalidateQueries({ queryKey: ["user"] });

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={u ? (u.name ?? u.email) : "Detail user"}
      description={u?.email}
    >
      {!d || !u ? (
        detail.isError ? (
          notFound ? (
            <StateMessage icon={UserX} title="User tidak ditemukan" />
          ) : (
            <StateMessage
              tone="error"
              icon={TriangleAlert}
              title="Gagal memuat detail user"
              description={errorMessage(detail.error)}
            />
          )
        ) : (
          <div className="flex flex-col gap-3" role="status" aria-label="Memuat data" aria-busy>
            <Skeleton className="h-8" />
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <PlanBadge user={u} />
            {founderUntilNote(u) && <Badge>{founderUntilNote(u)}</Badge>}
            {u.onboarded ? <Badge tone="green">onboarded</Badge> : <Badge>not onboarded</Badge>}
            <Badge>joined {fmtDate(u.createdAt)}</Badge>
            <Badge>last seen {fmtDateTime(u.lastSeen)}</Badge>
            <Badge>{fmtNum(u.foodLogs)} food logs</Badge>
          </div>

          <SectionCard title="Aktivitas scan">
            <CardFacts
              facts={[
                { label: "Kemarin", value: <DayScans value={u.scansYesterday} /> },
                { label: "Hari ini", value: <DayScans value={u.scansToday} /> },
                { label: "Streak (hari)", value: <Streak days={u.streak} /> },
                { label: "Scan terakhir", value: <LastScan user={u} /> },
                { label: "7 hari", value: fmtNum(u.scans7d) },
                { label: "Total", value: fmtNum(u.scansTotal) },
              ]}
            />
          </SectionCard>

          <SectionCard title="Tier controls">
            <TierControls user={u} />
          </SectionCard>

          <SectionCard title="Scans per hari (30 hari, WIB)">
            <BarChart
              height={100}
              formatValue={fmtNum}
              rows={d.perDay.map((day) => ({
                key: day.day,
                label: `${day.day.slice(8)}/${day.day.slice(5, 7)}`,
                value: day.scans,
              }))}
            />
          </SectionCard>

          <DetailList<"calls", AiCall>
            kind="calls"
            title="AI calls"
            userId={userId}
            rowKey={(c, i) => `${c.createdAt}-${i}`}
            emptyTitle="Belum ada panggilan AI"
            card={(c) => (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <Badge>{c.kind}</Badge>
                    <span className="text-xs">{c.scanType}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                </div>
                <CardFacts
                  facts={[
                    { label: "Model", value: c.model },
                    { label: "Latency", value: `${fmtNum(c.latencyMs)} ms` },
                  ]}
                />
              </>
            )}
          />

          <DetailList<"foods", FoodLog>
            kind="foods"
            title="Food logs"
            userId={userId}
            rowKey={(f, i) => `${f.createdAt}-${i}`}
            emptyTitle="Belum ada food log"
            card={(f) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium">{f.name}</span>
                  <span className="text-sm font-semibold tabular-nums">{fmtNum(f.kcal)} kkal</span>
                </div>
                <CardFacts
                  facts={[
                    { label: "Meal", value: f.meal },
                    { label: "Date", value: f.date },
                    { label: "Source", value: f.source },
                    { label: "Logged", value: fmtDateTime(f.createdAt) },
                  ]}
                />
              </>
            )}
          />

          <DetailList<"orders", UserOrder>
            kind="orders"
            title="Orders"
            userId={userId}
            rowKey={(o) => o.orderId}
            emptyTitle="Belum ada order"
            card={(o) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-mono text-[0.6875rem] break-all">{o.orderId}</span>
                  <span className="shrink-0 text-sm font-semibold">
                    <Amount value={o.amountIdr} charged={chargedLabel(o)} />
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <OrderStatus status={o.status} />
                  <span className="text-muted-foreground">{orderMethod(o)}</span>
                </div>
                <CardFacts
                  facts={[
                    { label: "Created", value: fmtDateTime(o.createdAt) },
                    { label: "Paid", value: fmtDateTime(o.paidAt) },
                    { label: "Founder until", value: fmtDateTime(o.founderUntil) },
                  ]}
                />
                {o.status === "pending" && (
                  <div className="mt-3">
                    <CheckOrderButton orderId={o.orderId} onDone={refreshUser} />
                  </div>
                )}
              </>
            )}
          />

          <DetailList<"sessions", AdminSession>
            kind="sessions"
            title="Sessions"
            userId={userId}
            rowKey={(s, i) => `${s.createdAt}-${i}`}
            emptyTitle="Belum ada sesi"
            card={(s) => (
              <>
                <CardFacts
                  facts={[
                    { label: "Created", value: fmtDateTime(s.createdAt) },
                    { label: "Last active", value: fmtDateTime(s.updatedAt) },
                    { label: "IP", value: s.ipAddress ?? "—" },
                  ]}
                />
                <p className="mt-1.5 text-xs break-all text-muted-foreground">{s.userAgent ?? "—"}</p>
              </>
            )}
          />
        </div>
      )}
    </Sheet>
  );
}
