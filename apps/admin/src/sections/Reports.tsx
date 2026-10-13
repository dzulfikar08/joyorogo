import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EyeOff, Flag, Trash2 } from "lucide-react";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { del, get, post, type AdminReport, type PagedReports } from "../api";
import { useHashQuery } from "../hash";
import { Badge, ConfirmAction, Pagination, Select } from "../ui";

const REASON_LABEL: Record<AdminReport["reason"], string> = {
  spam: "Spam",
  kasar: "Kasar",
  salah_info: "Informasi salah",
  lainnya: "Lainnya",
};

/** Konten yang dilaporkan: potongan postingan atau komentar. */
function ReportContent({ report }: { report: AdminReport }) {
  if (report.postId) {
    return (
      <div className="min-w-0">
        <div className="font-medium">{report.postTitle ?? "(postingan dihapus)"}</div>
        {report.postCaption && (
          <div className="text-muted-foreground">“{report.postCaption}”</div>
        )}
        <div className="text-muted-foreground">
          @{report.postAuthorHandle ?? report.postAuthorName ?? "?"}
          {report.postVisibility ? ` · ${report.postVisibility}` : ""}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">“{report.commentBody ?? "(komentar dihapus)"}”</div>
      <div>@{report.commentAuthorHandle ?? report.commentAuthorName ?? "?"}</div>
    </div>
  );
}

export function ReportsSection() {
  const { params, set } = useHashQuery("reports");
  const status = params.get("status") ?? "pending";
  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("pageSize") ?? 50) || 50;
  const queryClient = useQueryClient();

  const sp = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  const reports = useQuery({
    queryKey: ["reports", sp.toString()],
    queryFn: () => get<PagedReports>(`/api/admin/reports?${sp}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["reports"] });
  const resolve = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`),
    onSuccess: () => {
      toast.success("Laporan ditutup.");
      void invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });
  const deletePost = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/admin/posts/${id}`),
    onSuccess: () => {
      toast.success("Postingan dihapus.");
      void invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });
  const deleteComment = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/admin/comments/${id}`),
    onSuccess: () => {
      toast.success("Komentar dihapus.");
      void invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });
  const busy = resolve.isPending || deletePost.isPending || deleteComment.isPending;

  const rows = reports.data?.reports ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => set({ status: v === "pending" ? null : v, page: null })}
          aria-label="Status laporan"
          options={[
            { value: "pending", label: "Belum ditangani" },
            { value: "resolved", label: "Selesai" },
            { value: "all", label: "Semua" },
          ]}
        />
      </div>

      <div className={cn("rounded-xl border border-border bg-card", reports.isPlaceholderData && "opacity-60")}>
        {reports.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : reports.isError ? (
          <p className="p-4 text-sm text-destructive">{String(reports.error)}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Konten</th>
                    <th>Alasan</th>
                    <th>Pelapor</th>
                    <th>Dilaporkan</th>
                    <th>Status</th>
                    <th>Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <ReportContent report={report} />
                      </td>
                      <td>
                        <Badge tone={report.reason === "spam" ? "amber" : "red"}>
                          <Flag className="size-3" />
                          {REASON_LABEL[report.reason]}
                        </Badge>
                        {report.note && <div className="text-muted-foreground">{report.note}</div>}
                      </td>
                      <td>
                        <div className="font-medium">{report.reporterName}</div>
                        <div className="text-muted-foreground">{report.reporterEmail}</div>
                      </td>
                      <td>{new Date(report.createdAt).toLocaleString("id-ID")}</td>
                      <td>
                        {report.resolvedAt ? (
                          <Badge tone="muted">Selesai</Badge>
                        ) : (
                          <Badge tone="amber">Menunggu</Badge>
                        )}
                      </td>
                      <td>
                        {report.resolvedAt ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {report.postId && (
                              <ConfirmAction
                                trigger={
                                  <>
                                    <Trash2 className="size-3.5" />
                                    Hapus post
                                  </>
                                }
                                title="Hapus postingan ini?"
                                description="Kudos, komentar, notifikasi, dan laporannya ikut terhapus."
                                destructive
                                confirmLabel="Hapus"
                                disabled={busy}
                                onConfirm={() => {
                                  deletePost.mutate(report.postId!);
                                }}
                              />
                            )}
                            {report.commentId && (
                              <ConfirmAction
                                trigger={
                                  <>
                                    <Trash2 className="size-3.5" />
                                    Hapus komentar
                                  </>
                                }
                                title="Hapus komentar ini?"
                                description="Laporan terkait ikut terhapus."
                                destructive
                                confirmLabel="Hapus"
                                disabled={busy}
                                onConfirm={() => {
                                  deleteComment.mutate(report.commentId!);
                                }}
                              />
                            )}
                            <ConfirmAction
                              trigger={
                                <>
                                  <EyeOff className="size-3.5" />
                                  Abaikan
                                </>
                              }
                              title="Tutup laporan tanpa menghapus?"
                              description="Konten tetap ada; laporan ditandai selesai."
                              disabled={busy}
                              confirmLabel="Tutup laporan"
                              onConfirm={() => {
                                resolve.mutate(report.id);
                              }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground">
                        Tidak ada laporan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3">
              <Pagination
                page={reports.data.page}
                pageSize={reports.data.pageSize}
                total={reports.data.total}
                onPage={(p) => set({ page: p === 1 ? null : p })}
                onPageSize={(s) => set({ pageSize: s === 50 ? null : s, page: null })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
