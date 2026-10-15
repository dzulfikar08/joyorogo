import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import {
  api,
  fmtDate,
  fmtDateTime,
  fmtIdr,
  get,
  toDate,
  type AdminUser,
  orderMethod,
  type UserDetail,
} from "../api";
import { Badge, ConfirmAction, DayBars, SectionCard } from "../ui";

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
    onError: (err) => toast.error(String(err)),
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

/** Asks the payment gateway about a pending order and settles it if paid. */
function CheckOrderButton({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const check = useMutation({
    mutationFn: () =>
      api<{ outcome: string }>(`/api/admin/orders/${orderId}/check`, {
        method: "POST",
      }),
    onSuccess: (res) => {
      toast.info(res.outcome);
      void qc.invalidateQueries({ queryKey: ["user"] });
    },
    onError: (err) => toast.error(String(err)),
  });
  return (
    <Button size="xs" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
      {check.isPending ? "Checking…" : "Check with gateway"}
    </Button>
  );
}

export function UserDetail({ userId, onClose }: { userId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["user", userId],
    queryFn: () => get<UserDetail>(`/api/admin/users/${userId}`),
  });
  const u = detail.data?.user;
  const d = detail.data;

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
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={(u.effectiveTier ?? u.tier) === "founder" ? "green" : "muted"}>
              {u.effectiveTier ?? u.tier}
              {(u.effectiveTier ?? u.tier) === "founder" &&
                u.manualTier !== "founder" &&
                u.founderUntil !== null &&
                ` until ${fmtDate(u.founderUntil)}`}
            </Badge>
            {u.manualTier === "founder" && <Badge tone="amber">comp</Badge>}
            {u.aiUnlimited && <Badge tone="amber">AI unlimited</Badge>}
            {u.onboarded ? <Badge tone="green">onboarded</Badge> : <Badge>not onboarded</Badge>}
            <Badge>joined {fmtDate(u.createdAt)}</Badge>
            <Badge>last seen {fmtDateTime(u.lastSeen)}</Badge>
            <Badge>
              scans {u.scansToday}/d · {u.scans7d}/7d · {u.scansTotal} total
            </Badge>
            <Badge>{u.foodLogs} food logs</Badge>
          </div>

          <SectionCard title="Tier controls">
            <TierControls user={u} />
          </SectionCard>

          <SectionCard title="Scans per day (last 30d)">
            <DayBars
              rows={[...d.perDay]
                .reverse()
                .slice(-30)
                .map((d) => ({ key: d.day, label: d.day.slice(5), value: d.scans }))}
            />
          </SectionCard>

          <SectionCard title={`Recent AI calls (${d.calls.length})`}>
            <div className="table-wrap max-h-64 overflow-y-auto">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Kind</th>
                    <th>Type</th>
                    <th>Model</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {d.calls.slice(0, 50).map((c, i) => (
                    <tr key={i}>
                      <td>{fmtDateTime(c.createdAt)}</td>
                      <td>{c.kind}</td>
                      <td>{c.scanType}</td>
                      <td className="text-muted-foreground">{c.model}</td>
                      <td className="tabular-nums">{c.latencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title={`Food logs (${d.foods.length})`}>
            <div className="table-wrap max-h-64 overflow-y-auto">
              <table>
                <thead>
                  <tr>
                    <th>Logged</th>
                    <th>Date</th>
                    <th>Meal</th>
                    <th>Name</th>
                    <th>kcal</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {d.foods.slice(0, 50).map((f, i) => (
                    <tr key={i}>
                      <td>{fmtDateTime(f.createdAt)}</td>
                      <td>{f.date}</td>
                      <td>{f.meal}</td>
                      <td>{f.name}</td>
                      <td className="tabular-nums">{f.kcal}</td>
                      <td className="text-muted-foreground">{f.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title={`Orders (${d.orders.length})`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Paid</th>
                    <th>Founder until</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.orders.map((o) => (
                    <tr key={o.orderId}>
                      <td className="font-mono text-[0.6875rem]">{o.orderId}</td>
                      <td>{fmtIdr(o.amountIdr)}</td>
                      <td className="whitespace-nowrap">{orderMethod(o)}</td>
                      <td>
                        <Badge
                          tone={
                            o.status === "paid"
                              ? "green"
                              : o.status === "pending"
                                ? "amber"
                                : "muted"
                          }
                        >
                          {o.status}
                        </Badge>
                      </td>
                      <td>{fmtDateTime(o.createdAt)}</td>
                      <td>{fmtDateTime(o.paidAt)}</td>
                      <td>{fmtDate(o.founderUntil)}</td>
                      <td>{o.status === "pending" && <CheckOrderButton orderId={o.orderId} />}</td>
                    </tr>
                  ))}
                  {d.orders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-muted-foreground">
                        No orders.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title={`Sessions (${d.sessions.length})`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Last active</th>
                    <th>User agent</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {d.sessions.map((s, i) => (
                    <tr key={i}>
                      <td>{fmtDateTime(s.createdAt)}</td>
                      <td>{fmtDateTime(s.updatedAt)}</td>
                      <td className="max-w-80 break-all text-muted-foreground">
                        {s.userAgent ?? "—"}
                      </td>
                      <td>{s.ipAddress ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}
    </Sheet>
  );
}
