import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, MessagesSquare, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, errorMessage, fmtDateTime, fmtNum, get } from "../api";
import type { ThreadsBotStatus, ThreadsMentionItem } from "../api";
import { Badge, Button, ConfirmAction, QueryBoundary, SectionCard, StatCard } from "../ui";

const MAX_REPLY_CHARS = 500;
const statusKey = ["threads-bot"] as const;
const listKey = (view: View) => ["threads-bot", "mentions", view] as const;

const VIEWS = [
  { id: "pending", label: "Antrian" },
  { id: "sent", label: "Terkirim" },
  { id: "other", label: "Dilewati" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const MODE_TONE = { off: "muted", review: "amber", auto: "green" } as const;
const MODE_LABEL = {
  off: "Mati",
  review: "Review: balasan menunggu persetujuan",
  auto: "Otomatis: balasan langsung terkirim",
} as const;
const TOKEN_TONE = { ok: "green", expiring: "amber", expired: "red" } as const;
const TOKEN_LABEL = {
  ok: "Token aktif",
  expiring: "Token hampir habis",
  expired: "Token kedaluwarsa",
} as const;

const SKIP_LABEL: Record<string, string> = {
  stale: "Lebih dari sehari",
  own_post: "Postingan sendiri",
  own_thread: "Di dalam thread kita",
  no_image: "Tanpa foto",
  no_author: "Tanpa username",
  duplicate_photo: "Foto sudah dijawab",
  user_cap: "Batas harian per user",
  global_cap: "Batas harian total",
  not_food: "Bukan makanan",
};
const STATUS_LABEL: Record<ThreadsMentionItem["status"], string> = {
  received: "Menunggu diproses",
  scanning: "Sedang dipindai",
  skipped: "Dilewati",
  pending_review: "Menunggu persetujuan",
  publishing: "Sedang dikirim",
  sent: "Terkirim",
  rejected: "Ditolak",
  failed: "Gagal",
};

const fieldClass =
  "w-full rounded-xl border border-transparent bg-muted px-3 py-2 text-sm text-foreground transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60";

/** `#threads?connected=1` / `?error=...` is where Meta's OAuth redirect lands. */
function useConnectResult() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const [, query = ""] = window.location.hash.replace(/^#/, "").split("?");
    if (!query) return;
    const params = new URLSearchParams(query);
    if (params.has("connected")) {
      toast.success("Akun Threads terhubung");
      void queryClient.invalidateQueries({ queryKey: statusKey });
    } else if (params.has("error")) {
      toast.error(`Gagal menghubungkan Threads: ${params.get("error")}`);
    }
    window.history.replaceState(null, "", `${window.location.pathname}#threads`);
  }, [queryClient]);
}

function Setup({ status }: { status: ThreadsBotStatus }) {
  const missing = [
    !status.configured.app && "THREADS_APP_ID dan THREADS_APP_SECRET",
    !status.configured.webhook && "THREADS_WEBHOOK_VERIFY_TOKEN",
  ].filter(Boolean);
  if (missing.length === 0 && status.account) return null;
  return (
    <SectionCard title="Yang belum siap">
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {missing.length > 0 && (
          <li>Secret belum diisi: {missing.join(", ")} (wrangler secret put).</li>
        )}
        {!status.account && (
          <li>
            Belum ada token Threads: klik “Hubungkan Threads” atau isi secret THREADS_ACCESS_TOKEN.
          </li>
        )}
      </ul>
    </SectionCard>
  );
}

function StatusCard({ status }: { status: ThreadsBotStatus }) {
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: () => get<{ url: string }>("/api/admin/threads-bot/connect"),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const poll = useMutation({
    mutationFn: () =>
      api<{ polled: number; handled: number; swept: number }>("/api/admin/threads-bot/poll", {
        method: "POST",
      }),
    onSuccess: (result) => {
      toast.success(`${fmtNum(result.polled)} mention dibaca, ${fmtNum(result.handled)} diproses`);
      void queryClient.invalidateQueries({ queryKey: ["threads-bot"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const account = status.account;
  return (
    <SectionCard
      title="Bot mention Threads"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={MODE_TONE[status.mode]}>{MODE_LABEL[status.mode]}</Badge>
          <Button
            size="sm"
            variant="outline"
            disabled={poll.isPending || status.mode === "off"}
            onClick={() => poll.mutate()}
          >
            <RefreshCw className="size-4" />
            Baca mention sekarang
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            <Link2 className="size-4" />
            {account ? "Hubungkan ulang" : "Hubungkan Threads"}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Dipindai hari ini"
          value={fmtNum(status.today.scans)}
          hint={`batas ${fmtNum(status.caps.global)} per hari`}
        />
        <StatCard label="Balasan terkirim hari ini" value={fmtNum(status.today.sent)} />
        <StatCard label="Menunggu persetujuan" value={fmtNum(status.today.pending)} />
        <StatCard
          label="Batas per user"
          value={`${fmtNum(status.caps.user)}/hari`}
          hint={`rentang kcal ±${Math.round(status.band * 100)}%`}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {account ? (
          <>
            <Badge tone={TOKEN_TONE[account.status]}>{TOKEN_LABEL[account.status]}</Badge>
            <span>@{account.username ?? "?"}</span>
            <span>habis {fmtDateTime(account.expiresAt)}</span>
            <span>({account.source === "seed" ? "dari secret" : "lewat Hubungkan"})</span>
            <span>dibaca terakhir {fmtDateTime(account.lastPolledAt)}</span>
          </>
        ) : (
          <Badge tone="red">Belum terhubung</Badge>
        )}
      </div>
      {account?.lastError && (
        <p className="mt-2 text-xs text-destructive">Error terakhir: {account.lastError}</p>
      )}
      <dl className="mt-3 grid gap-1 text-xs text-muted-foreground md:grid-cols-[auto_1fr] md:gap-x-3">
        <dt className="font-medium">Webhook URL</dt>
        <dd className="break-all font-mono">{status.webhookUrl}</dd>
        <dt className="font-medium">Redirect URI OAuth</dt>
        <dd className="break-all font-mono">{status.redirectUri}</dd>
      </dl>
    </SectionCard>
  );
}

function Draft({ item }: { item: ThreadsMentionItem }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(item.replyText ?? "");
  useEffect(() => setText(item.replyText ?? ""), [item.replyText]);
  const changed = text !== (item.replyText ?? "");
  const tooLong = text.length > MAX_REPLY_CHARS;
  const busy = item.status === "publishing";

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["threads-bot"] });
  const path = `/api/admin/threads-bot/mentions/${encodeURIComponent(item.mediaId)}`;
  const save = useMutation({
    mutationFn: () => api(path, { method: "PATCH", json: { text } }),
    onSuccess: () => {
      toast.success("Draft disimpan");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const approve = useMutation({
    mutationFn: () => api(`${path}/approve`, { method: "POST", json: changed ? { text } : {} }),
    onSuccess: () => {
      toast.success("Balasan terkirim ke Threads");
      refresh();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      refresh();
    },
  });
  const reject = useMutation({
    mutationFn: () => api(`${path}/reject`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Draft ditolak");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <li className="grid gap-4 p-4 md:grid-cols-[14rem_1fr]">
      <div className="flex flex-col gap-2">
        {item.photoUrl ? (
          <img
            src={item.photoUrl}
            alt={`Foto dari @${item.author}`}
            referrerPolicy="no-referrer"
            className="max-h-64 w-full rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            Foto tidak bisa dimuat
          </div>
        )}
        <p className="text-[0.6875rem] text-muted-foreground">
          Foto dimuat langsung dari Threads, tidak disimpan di JoyoRogo.
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">@{item.author || "?"}</span>
          <span className="text-xs text-muted-foreground">{fmtDateTime(item.createdAt)}</span>
          <Badge tone={item.kind === "unclear" ? "amber" : "green"}>
            {item.kind === "unclear" ? "Foto kurang jelas" : "Perkiraan kalori"}
          </Badge>
          {item.permalink && (
            <a
              href={item.permalink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Buka di Threads <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        {item.dishes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {item.dishes.map((dish) => `${dish.name} ${dish.low}–${dish.high}`).join(" · ")} kcal,
            total {item.kcalLow}–{item.kcalHigh}
          </p>
        )}
        <textarea
          className={`${fieldClass} min-h-40 font-sans`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
          aria-label="Teks balasan"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={`text-xs tabular-nums ${tooLong ? "text-destructive" : "text-muted-foreground"}`}
          >
            {text.length}/{MAX_REPLY_CHARS}
          </span>
          <div className="flex flex-wrap gap-2">
            <ConfirmAction
              trigger="Tolak"
              triggerVariant="ghost"
              title="Tolak draft ini?"
              description={`Tidak ada balasan yang dikirim ke @${item.author}.`}
              destructive
              confirmLabel="Tolak"
              disabled={busy || reject.isPending}
              onConfirm={() => reject.mutate()}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!changed || tooLong || text.trim() === "" || save.isPending || busy}
              onClick={() => save.mutate()}
            >
              Simpan edit
            </Button>
            <ConfirmAction
              trigger="Setujui & kirim"
              triggerVariant="default"
              title="Kirim balasan ke Threads?"
              description={`Balasan publik akan diposting sebagai akun brand di bawah post @${item.author}.`}
              confirmLabel="Kirim"
              disabled={tooLong || text.trim() === "" || approve.isPending || busy}
              onConfirm={() => approve.mutate()}
            />
          </div>
        </div>
        {item.error && (
          <p className="text-xs text-destructive">Percobaan sebelumnya gagal: {item.error}</p>
        )}
      </div>
    </li>
  );
}

function LogRow({ item }: { item: ThreadsMentionItem }) {
  const detail =
    item.status === "skipped" ? (SKIP_LABEL[item.skipReason ?? ""] ?? item.skipReason) : item.error;
  return (
    <li className="flex flex-col gap-1 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">@{item.author || "?"}</span>
        <Badge tone={item.status === "sent" ? "green" : item.status === "failed" ? "red" : "muted"}>
          {STATUS_LABEL[item.status]}
        </Badge>
        {item.mode && item.status === "sent" && (
          <Badge>
            {item.mode === "auto" ? "otomatis" : `disetujui ${item.reviewedBy ?? ""}`.trim()}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {fmtDateTime(item.sentAt ?? item.createdAt)}
        </span>
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      </div>
      {item.replyText && (
        <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
          {item.replyText}
        </p>
      )}
    </li>
  );
}

function Queue({ view }: { view: View }) {
  const query = useQuery({
    queryKey: listKey(view),
    queryFn: () =>
      get<{ items: ThreadsMentionItem[] }>(`/api/admin/threads-bot/mentions?view=${view}`),
    refetchInterval: view === "pending" ? 30_000 : false,
  });
  return (
    <QueryBoundary
      query={query}
      isEmpty={(data) => data.items.length === 0}
      empty={{
        title:
          view === "pending"
            ? "Antrian kosong"
            : view === "sent"
              ? "Belum ada balasan terkirim"
              : "Belum ada yang dilewati",
        icon: MessagesSquare,
      }}
    >
      {(data) => (
        <ul className="divide-y divide-border">
          {data.items.map((item) =>
            view === "pending" ? (
              <Draft key={item.mediaId} item={item} />
            ) : (
              <LogRow key={item.mediaId} item={item} />
            ),
          )}
        </ul>
      )}
    </QueryBoundary>
  );
}

export function ThreadsBotSection() {
  useConnectResult();
  const [view, setView] = useState<View>("pending");
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => get<ThreadsBotStatus>("/api/admin/threads-bot"),
    refetchInterval: 60_000,
  });
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={status} isEmpty={() => false} empty={{ title: "" }} skeletonRows={2}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <StatusCard status={data} />
            <Setup status={data} />
          </div>
        )}
      </QueryBoundary>
      <SectionCard
        title="Balasan"
        flush
        action={
          <div role="tablist" className="flex gap-1 rounded-full border border-border p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setView(v.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        }
      >
        <Queue view={view} />
      </SectionCard>
    </div>
  );
}
