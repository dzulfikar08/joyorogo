import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Mail, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Input } from "@joyorogo/ui/components/input";

import { api, errorMessage, fmtDateTime, fmtNum, get } from "../api";
import type { BroadcastConfig, BroadcastSendResult, BroadcastStatus } from "../api";
import { Badge, Button, ConfirmAction, QueryBoundary, SectionCard, StatCard } from "../ui";

const STATE_LABEL = { idle: "Belum dikirim", sending: "Sedang dikirim", done: "Selesai" } as const;
const STATE_TONE = { idle: "muted", sending: "amber", done: "green" } as const;

const fieldClass =
  "w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-base text-foreground transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60";

const statusKey = (id: string) => ["broadcast-status", id] as const;

function Composer({ config }: { config: BroadcastConfig }) {
  const queryClient = useQueryClient();
  const [id, setId] = useState(config.campaign.id);
  const [subject, setSubject] = useState(config.campaign.subject);
  const [body, setBody] = useState(config.campaign.body);
  const [preview, setPreview] = useState<{ html: string; text: string } | null>(null);
  const [previewView, setPreviewView] = useState<"html" | "text">("html");
  const [sending, setSending] = useState(false);

  const idValid = /^[a-z0-9][a-z0-9-]{2,39}$/.test(id);
  const status = useQuery({
    queryKey: statusKey(id),
    queryFn: () => get<BroadcastStatus>(`/api/admin/broadcast/status?id=${encodeURIComponent(id)}`),
    enabled: idValid,
    refetchInterval: (query) => (query.state.data?.state === "sending" ? 5_000 : 60_000),
  });
  const current = status.data;
  // Once started, the server sends the text confirmed at the first click, whatever is typed here.
  const frozen = current !== undefined && current.state !== "idle" && current.campaign !== null;
  useEffect(() => {
    if (frozen && current?.campaign) {
      setSubject(current.campaign.subject);
      setBody(current.campaign.body);
    }
  }, [frozen, current?.campaign]);

  const payload = { subject, body };
  const previewMutation = useMutation({
    mutationFn: () => api<{ html: string; text: string }>("/api/admin/broadcast/preview", { method: "POST", json: payload }),
    onSuccess: setPreview,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const testMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; error?: string; logged: boolean }>("/api/admin/broadcast/test", { method: "POST", json: { id, ...payload } }),
    onSuccess: (result) => toast.success(result.logged ? "Email tes terkirim ke kamu" : "Email tes terkirim"),
    onError: (error) => toast.error(errorMessage(error)),
  });

  /** Mails batch after batch until nobody is left, a batch stops early, or a call fails. */
  const sendAll = async (expected: number) => {
    setSending(true);
    try {
      let target = expected;
      for (;;) {
        const result = await api<BroadcastSendResult>("/api/admin/broadcast/send", {
          method: "POST",
          json: { id, ...payload, expected: target },
        });
        queryClient.setQueryData(statusKey(id), result.status);
        target = 0;
        if (result.status.remaining === 0) {
          toast.success(`Selesai: ${fmtNum(result.status.sent)} email terkirim`);
          return;
        }
        if (result.batch.stopped) {
          toast.error(`Berhenti: ${result.batch.stopped}. Klik Kirim lagi, atau tunggu cron (5 menit) yang melanjutkan.`);
          return;
        }
        if (result.batch.sent === 0 && result.batch.failed === 0) return;
      }
    } catch (error) {
      toast.error(errorMessage(error));
      void queryClient.invalidateQueries({ queryKey: statusKey(id) });
    } finally {
      setSending(false);
    }
  };

  const remaining = current?.remaining ?? 0;
  const canSend = idValid && !sending && current !== undefined && remaining > 0;
  const sender = `${config.sender.name} <${config.sender.email}>`;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Penerima"
        action={current && <Badge tone={STATE_TONE[current.state]}>{STATE_LABEL[current.state]}</Badge>}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Email terverifikasi" value={current ? fmtNum(current.eligible) : "…"} />
          <StatCard label="Berhenti berlangganan" value={current ? fmtNum(current.optedOut) : "…"} />
          <StatCard label="Sudah dikirimi" value={current ? fmtNum(current.sent) : "…"} />
          <StatCard
            label="Akan dikirimi"
            value={current ? fmtNum(current.remaining) : "…"}
            hint={current && current.failed > 0 ? `${fmtNum(current.failed)} gagal berulang, dilewati` : undefined}
          />
        </div>
        {current?.startedAt && (
          <p className="mt-3 text-xs text-muted-foreground">
            Mulai {fmtDateTime(current.startedAt)}
            {current.finishedAt ? `, selesai ${fmtDateTime(current.finishedAt)}` : ""}
          </p>
        )}
      </SectionCard>

      <SectionCard title="Tulis email" action={<span className="text-xs text-muted-foreground">Dari {sender}</span>}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            ID kampanye
            <Input
              value={id}
              onChange={(event) => setId(event.target.value.trim().toLowerCase())}
              disabled={frozen || sending}
              aria-invalid={!idValid}
              spellCheck={false}
            />
            <span className="text-xs font-normal text-muted-foreground">
              Satu pengguna hanya sekali per ID kampanye. Huruf kecil, angka, tanda minus; 3 sampai 40 karakter.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Subjek
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={frozen || sending} maxLength={200} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Isi
            <textarea
              className={`${fieldClass} min-h-96 font-mono text-sm leading-relaxed`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={frozen || sending}
              spellCheck={false}
            />
            <span className="text-xs font-normal text-muted-foreground">
              Markdown ringan: **tebal**, baris yang diawali "- " jadi daftar, tautan https:// otomatis aktif. {"{nama}"} diganti nama
              depan (cadangan "kamu"). Tautan berhenti berlangganan selalu ditambahkan di bawah.
            </span>
          </label>
          {frozen && (
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              Kampanye ini sudah dimulai; isi yang dikirim tetap yang dikonfirmasi saat pertama kali. Ganti ID kampanye untuk email baru.
            </p>
          )}
          <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
            <Button variant="outline" disabled={previewMutation.isPending || !subject.trim() || !body.trim()} onClick={() => previewMutation.mutate()}>
              <Eye className="size-4" />
              {previewMutation.isPending ? "Memuat…" : "Pratinjau"}
            </Button>
            <Button
              variant="outline"
              disabled={testMutation.isPending || !idValid || !subject.trim() || !body.trim()}
              onClick={() => testMutation.mutate()}
            >
              <Mail className="size-4" />
              {testMutation.isPending ? "Mengirim…" : "Kirim tes ke saya"}
            </Button>
            <ConfirmAction
              trigger={
                <>
                  <Send className="size-4" />
                  {sending ? "Mengirim…" : current?.state === "sending" ? "Lanjutkan kirim" : "Kirim ke semua"}
                </>
              }
              triggerVariant="default"
              triggerSize="default"
              disabled={!canSend || !subject.trim() || !body.trim()}
              title={`Kirim ke ${fmtNum(remaining)} pengguna?`}
              description={
                <>
                  Email &ldquo;{subject}&rdquo; dikirim dari {sender} ke {fmtNum(remaining)} pengguna dengan email terverifikasi, tanpa yang
                  sudah berhenti berlangganan atau sudah menerimanya. Tidak bisa ditarik kembali.
                </>
              }
              confirmLabel={`Kirim ke ${fmtNum(remaining)}`}
              onConfirm={() => void sendAll(remaining)}
            />
          </div>
        </div>
      </SectionCard>

      {preview && (
        <SectionCard
          title="Pratinjau"
          action={
            <div className="flex gap-1">
              <Button size="xs" variant={previewView === "html" ? "default" : "ghost"} onClick={() => setPreviewView("html")}>
                HTML
              </Button>
              <Button size="xs" variant={previewView === "text" ? "default" : "ghost"} onClick={() => setPreviewView("text")}>
                Teks
              </Button>
            </div>
          }
        >
          {previewView === "html" ? (
            <iframe title="Pratinjau email" sandbox="" srcDoc={preview.html} className="h-[40rem] w-full rounded-xl border border-border bg-white" />
          ) : (
            <pre className="max-h-[40rem] overflow-auto rounded-xl bg-muted p-4 text-sm whitespace-pre-wrap">{preview.text}</pre>
          )}
        </SectionCard>
      )}
    </div>
  );
}

/** Announcement mail: compose, preview, test to myself, then send to all (with the recipient count confirmed). */
export function EmailSection() {
  const config = useQuery({
    queryKey: ["broadcast-config"],
    queryFn: () => get<BroadcastConfig>("/api/admin/broadcast"),
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  return (
    <QueryBoundary query={config} isEmpty={() => false} empty={{ title: "Kosong" }}>
      {(data) => <Composer config={data} />}
    </QueryBoundary>
  );
}
