import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bell, ChevronRight, KeyRound, Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyHint } from "@/components/screen-state";
import { ListGroup, ListLinkRow, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

const listOptions = orpc.group.list.queryOptions();

export const Route = createFileRoute("/_auth/grup/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(listOptions),
  pendingComponent: GrupSkeleton,
  component: GrupPage,
});

function GrupSkeleton() {
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label="Memuat grup">
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-28 rounded-full" />
        <Skeleton className="size-11 rounded-full" />
      </div>
      <Skeleton className="h-24 rounded-3xl" />
      <Skeleton className="mt-3 h-24 rounded-3xl" />
    </Page>
  );
}

function GrupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const groups = useQuery(listOptions);
  const unread = useQuery(orpc.group.unreadCount.queryOptions());
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [previewCode, setPreviewCode] = useState<string | null>(null);

  const preview = useQuery({
    ...orpc.group.preview.queryOptions({ input: { code: previewCode ?? "" } }),
    enabled: previewCode !== null,
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: orpc.group.key() });
  };

  const create = useMutation(
    orpc.group.create.mutationOptions({
      onSuccess: () => {
        toast.success("Grup dibuat. Bagikan kode undangannya!");
        setCreateOpen(false);
        setName("");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const join = useMutation(
    orpc.group.join.mutationOptions({
      onSuccess: ({ groupId }) => {
        toast.success("Berhasil gabung!");
        setJoinOpen(false);
        setCode("");
        setPreviewCode(null);
        invalidate();
        void navigate({ to: "/grup/$groupId", params: { groupId } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const checkCode = () => {
    const trimmed = code.trim();
    if (trimmed.length < 4 || trimmed.length > 20) {
      toast.error("Kode undangan 4–20 karakter.");
      return;
    }
    setPreviewCode(trimmed);
  };

  return (
    <Page className="max-w-xl">
      <PageHeader
        title="Grup"
        subtitle="Semangat bareng, curi perhatian ala VAR."
        action={
          <Link
            to="/inbox"
            aria-label={`Kotak masuk${unread.data?.count ? `, ${unread.data.count} belum dibaca` : ""}`}
            className="relative flex size-11 items-center justify-center rounded-full bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Bell className="size-5" aria-hidden />
            {unread.data?.count ? (
              <span className="absolute top-1.5 right-1.5 grid min-w-[1.15rem] place-items-center rounded-full bg-destructive px-1 text-[0.625rem] leading-4 font-bold text-white">
                {unread.data.count > 9 ? "9+" : unread.data.count}
              </span>
            ) : null}
          </Link>
        }
      />

      {groups.data && groups.data.length > 0 && (
        <section aria-label="Daftar grup" className="mt-1">
          <ListGroup className="p-0">
            {groups.data.map((group) => (
              <ListLinkRow
                key={group.id}
                to="/grup/$groupId"
                params={{ groupId: group.id }}
                icon={<Users className="size-5 text-primary" aria-hidden />}
                title={group.name}
                subtitle={
                  group.role === "owner"
                    ? `Kamu pemilik · ${group.memberCount} anggota`
                    : `${group.memberCount} anggota`
                }
              />
            ))}
          </ListGroup>
        </section>
      )}

      {groups.data && groups.data.length === 0 && (
        <div className="mt-1">
          <EmptyHint title="Belum ada grup" pose="cheer">
            Buat grup untuk teman sekantor atau sekeluarga, lalu bagikan kode undangannya.
          </EmptyHint>
        </div>
      )}

      <SectionTitle className="mt-6">Mulai</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant="secondary" size="lg" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Buat grup
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setJoinOpen(true)}>
          <KeyRound className="size-4" aria-hidden />
          Gabung pakai kode
        </Button>
      </div>

      <Sheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Buat grup"
        description="Maksimal 5 grup per akun, 20 anggota per grup."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ name });
          }}
          className="space-y-4"
        >
          <Input
            aria-label="Nama grup"
            placeholder="mis. Tim Sehat Kantor"
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" className="w-full" disabled={create.isPending || name.trim() === ""}>
            {create.isPending ? "Membuat..." : "Buat"}
          </Button>
        </form>
      </Sheet>

      <Sheet
        open={joinOpen}
        onOpenChange={(open) => {
          setJoinOpen(open);
          if (!open) {
            setCode("");
            setPreviewCode(null);
          }
        }}
        title="Gabung grup"
        description="Minta kode ke temanmu, atau buka tautan undangannya."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            checkCode();
          }}
          className="space-y-4"
        >
          <Input
            aria-label="Kode undangan"
            placeholder="mis. JOYO1234"
            autoCapitalize="characters"
            maxLength={20}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Button type="submit" variant="secondary" className="w-full" disabled={code.trim() === ""}>
            Cek kode
          </Button>
        </form>
        {previewCode !== null && (
          <div className="mt-4 rounded-2xl bg-muted p-4">
            {preview.isPending && <p className="text-sm text-muted-foreground">Memeriksa kode…</p>}
            {preview.isError && (
              <p className="text-sm font-semibold text-destructive">{preview.error.message}</p>
            )}
            {preview.data && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{preview.data.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {preview.data.memberCount} anggota
                  </p>
                </div>
                {preview.data.alreadyMember ? (
                  <p className="max-w-[10rem] text-right text-xs font-semibold text-muted-foreground">
                    Kamu sudah anggota grup ini.
                  </p>
                ) : (
                  <Button onClick={() => join.mutate({ code: previewCode })} disabled={join.isPending}>
                    {join.isPending ? "Gabung…" : "Gabung"}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>

      <p className="mt-8 flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <ChevronRight className="size-3.5" aria-hidden />
        Colek teman yang malas catat, atau intip isi perutnya lewat VAR.
      </p>
    </Page>
  );
}
