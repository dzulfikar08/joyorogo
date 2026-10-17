import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EyeOff, Flag, FlagOff, Trash2 } from "lucide-react";
import { SERVER_URL } from "../auth-client";
import {
  del,
  errorMessage,
  fmtDateTime,
  get,
  post,
  type AdminReport,
  type PagedReports,
} from "../api";
import { useClampPage, useHashQuery, usePaging } from "../hash";
import {
  Badge,
  CardFacts,
  ConfirmAction,
  DataList,
  Pagination,
  QueryBoundary,
  Select,
  type Column,
} from "../ui";

const REASON_LABEL: Record<AdminReport["reason"], string> = {
  spam: "Spam",
  kasar: "Kasar",
  salah_info: "Informasi salah",
  lainnya: "Lainnya",
};

const STATUSES = ["pending", "resolved", "all"];

/** Konten yang dilaporkan: potongan postingan atau komentar. */
function ReportContent({ report }: { report: AdminReport }) {
  if (report.postId) {
    const hasPhoto =
      report.postPhotoId !== null ||
      (() => {
        try {
          const parsed = report.postPhotosJson ? (JSON.parse(report.postPhotosJson) as unknown) : null;
          return Array.isArray(parsed) && parsed.length > 0;
        } catch {
          return false;
        }
      })();
    return (
      <div className="flex min-w-0 items-start gap-3">
        {hasPhoto && (
          <img
            src={`${SERVER_URL}/post-photo/${report.postId}`}
            alt=""
            loading="lazy"
            className="size-14 shrink-0 rounded-lg bg-muted object-cover"
          />
        )}
        <div className="min-w-0 break-words">
          {report.postKind === "cerita" ? (
            report.postCaption && <div className="font-medium">“{report.postCaption}”</div>
          ) : (
            <div className="font-medium">{report.postTitle ?? "(postingan dihapus)"}</div>
          )}
          {report.postKind !== "cerita" && report.postCaption && (
            <div className="text-muted-foreground">“{report.postCaption}”</div>
          )}
          <div className="text-muted-foreground">
            @{report.postAuthorHandle ?? report.postAuthorName ?? "?"}
            {report.postKind ? ` · ${report.postKind}` : ""}
            {report.postVisibility ? ` · ${report.postVisibility}` : ""}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 break-words">
      <div className="text-muted-foreground">“{report.commentBody ?? "(komentar dihapus)"}”</div>
      <div>@{report.commentAuthorHandle ?? report.commentAuthorName ?? "?"}</div>
    </div>
  );
}

function ReasonBadge({ report }: { report: AdminReport }) {
  return (
    <Badge tone={report.reason === "spam" ? "amber" : "red"}>
      <Flag className="size-3" />
      {REASON_LABEL[report.reason]}
    </Badge>
  );
}

function StatusBadge({ report }: { report: AdminReport }) {
  return report.resolvedAt ? <Badge tone="muted">Selesai</Badge> : <Badge tone="amber">Menunggu</Badge>;
}

export function ReportsSection() {
  const { params, set } = useHashQuery("reports");
  const statusParam = params.get("status") ?? "pending";
  const status = STATUSES.includes(statusParam) ? statusParam : "pending";
  const paging = usePaging(params, set);
  const queryClient = useQueryClient();

  const sp = new URLSearchParams({
    status,
    page: String(paging.page),
    pageSize: String(paging.pageSize),
  });
  const reports = useQuery({
    queryKey: ["reports", sp.toString()],
    queryFn: () => get<PagedReports>(`/api/admin/reports?${sp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(reports.data?.total, paging, !reports.isPlaceholderData);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["reports"] });
  const resolve = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`),
    onSuccess: () => {
      toast.success("Laporan ditutup.");
      void invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const deletePost = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/admin/posts/${id}`),
    onSuccess: () => {
      toast.success("Postingan dihapus.");
      void invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const deleteComment = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/admin/comments/${id}`),
    onSuccess: () => {
      toast.success("Komentar dihapus.");
      void invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const busy = resolve.isPending || deletePost.isPending || deleteComment.isPending;

  const actions = (report: AdminReport) =>
    report.resolvedAt ? (
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
    );

  const columns: Column<AdminReport>[] = [
    { key: "content", header: "Konten", cell: (r) => <ReportContent report={r} /> },
    {
      key: "reason",
      header: "Alasan",
      cell: (r) => (
        <>
          <ReasonBadge report={r} />
          {r.note && <div className="text-muted-foreground">{r.note}</div>}
        </>
      ),
    },
    {
      key: "reporter",
      header: "Pelapor",
      cell: (r) => (
        <>
          <div className="font-medium">{r.reporterName}</div>
          <div className="text-muted-foreground">{r.reporterEmail}</div>
        </>
      ),
    },
    { key: "at", header: "Dilaporkan", cell: (r) => fmtDateTime(r.createdAt), className: "whitespace-nowrap" },
    { key: "status", header: "Status", cell: (r) => <StatusBadge report={r} /> },
    { key: "actions", header: "Tindakan", cell: actions },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => set({ status: v === "pending" ? null : v, page: null })}
          aria-label="Status laporan"
          className="w-full sm:w-auto"
          options={[
            { value: "pending", label: "Belum ditangani" },
            { value: "resolved", label: "Selesai" },
            { value: "all", label: "Semua" },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <QueryBoundary
          query={reports}
          isEmpty={(d) => d.reports.length === 0}
          empty={{
            icon: FlagOff,
            title: "Tidak ada laporan",
            description:
              status === "pending" ? "Semua laporan sudah ditangani." : undefined,
          }}
        >
          {(d) => (
            <>
              <DataList
                rows={d.reports}
                rowKey={(r) => r.id}
                columns={columns}
                card={(r) => (
                  <>
                    <ReportContent report={r} />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ReasonBadge report={r} />
                      <StatusBadge report={r} />
                    </div>
                    {r.note && <p className="mt-1.5 text-xs break-words text-muted-foreground">{r.note}</p>}
                    <CardFacts
                      facts={[
                        { label: "Pelapor", value: r.reporterName },
                        { label: "Dilaporkan", value: fmtDateTime(r.createdAt) },
                      ]}
                    />
                    {!r.resolvedAt && <div className="mt-3">{actions(r)}</div>}
                  </>
                )}
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
    </div>
  );
}
