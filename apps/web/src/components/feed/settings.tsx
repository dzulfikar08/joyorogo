import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Globe, ShieldBan } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Avatar } from "@/components/avatar";
import { Segmented, ListGroup, ListRow, FieldLabel } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { useSession } from "@/lib/auth-client";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

const HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;
const BIO_MAX = 160;

type Visibility = "publik" | "grup";

/**
 * Pengaturan feed komunitas di /profil: handle & bio, toggle profil publik,
 * visibility default, dan daftar blokir dengan buka blokir. Cermin dari
 * components/feed/settings.tsx di native.
 */
export function FeedSettingsSection() {
  const queryClient = useQueryClient();
  const session = useSession();
  const profile = useQuery(orpc.social.myProfile.queryOptions());
  const blockList = useQuery(orpc.social.blockList.queryOptions());
  const [editOpen, setEditOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.social.key() });
  const myProfileKey = orpc.social.myProfile.queryOptions().queryKey;

  // Optimistic profile patch + undo re-applies the previous publicProfile.
  const previousPublic = useRef<boolean | null>(null);
  const togglePublic = useOptimisticMutation<
    Parameters<AppRouterClient["social"]["updateProfile"]>[0],
    unknown
  >({
    mutationFn: (input) => client.social.updateProfile(input),
    patch: (input, cache) => {
      previousPublic.current = profile.data?.publicProfile ?? null;
      cache.value(myProfileKey, (old) =>
        old && input.publicProfile !== undefined ? { ...old, publicProfile: input.publicProfile } : old,
      );
    },
    invalidate: () => [orpc.social.key()],
    success: (input) => {
      const prev = previousPublic.current;
      previousPublic.current = null;
      const nowOn = input.publicProfile === true;
      return {
        message: nowOn ? "Profil publik dinyalakan." : "Profil publik dimatikan.",
        undo:
          prev === null
            ? undefined
            : () => void client.social.updateProfile({ publicProfile: !prev }),
      };
    },
  });

  const data = profile.data;

  return (
    <>
      {profile.isPending ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : profile.error ? (
        <p className="text-sm font-semibold text-destructive">{profile.error.message}</p>
      ) : (
        <ListGroup className="mt-1">
          <ListRow
            onClick={() => setEditOpen(true)}
            icon={
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-makan-soft">
                <AtSign className="size-5 text-makan-ink" aria-hidden />
              </span>
            }
            title="Handle & bio"
            subtitle={data?.handle ? `@${data.handle}` : "Belum ada handle"}
          />
          <ListRow
            icon={
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tidur-soft">
                <Globe className="size-5 text-tidur-ink" aria-hidden />
              </span>
            }
            title="Profil publik"
            subtitle="Post publik tampil di Jelajah dan profil /u/handle"
            trailing={
              <Switch
                checked={data?.publicProfile ?? true}
                onCheckedChange={(checked) => togglePublic.mutate({ publicProfile: checked })}
                disabled={togglePublic.isPending}
                label="Profil publik"
              />
            }
          />
          <ListRow
            onClick={() => setBlockOpen(true)}
            icon={
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bakar-soft">
                <ShieldBan className="size-5 text-bakar-ink" aria-hidden />
              </span>
            }
            title="Akun diblokir"
            subtitle={
              (blockList.data?.length ?? 0) > 0
                ? `${blockList.data?.length} akun disembunyikan`
                : "Belum ada yang diblokir"
            }
          />
        </ListGroup>
      )}

      {data ? (
        <EditSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          initial={{
            handle: data.handle ?? "",
            bio: data.bio ?? "",
            defaultVisibility: data.defaultVisibility,
          }}
          onSaved={() => void refresh()}
        />
      ) : null}

      <Sheet
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title="Akun diblokir"
        description="Post dan komentar mereka disembunyikan, begitu juga sebaliknya."
      >
        <BlockList
          myId={session.data?.user.id ?? null}
          onUnblock={() => void refresh()}
        />
      </Sheet>
    </>
  );
}

function EditSheet({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { handle: string; bio: string; defaultVisibility: Visibility };
  onSaved: () => void;
}) {
  const [handle, setHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio);
  const [visibility, setVisibility] = useState<Visibility>(initial.defaultVisibility);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setHandle(initial.handle);
      setBio(initial.bio);
      setVisibility(initial.defaultVisibility);
      setError(null);
    }
  }, [open, initial]);

  // Optimistic myProfile patch; undo re-applies the values from before the save.
  const previousProfile = useRef<{
    handle: string;
    bio: string;
    defaultVisibility: Visibility;
  } | null>(null);
  const update = useOptimisticMutation<
    Parameters<AppRouterClient["social"]["updateProfile"]>[0],
    unknown
  >({
    mutationFn: (input) => client.social.updateProfile(input),
    patch: (input, cache) => {
      const key = orpc.social.myProfile.queryOptions().queryKey;
      previousProfile.current = null;
      cache.value<{
        handle?: string | null;
        bio?: string | null;
        defaultVisibility?: Visibility;
      }>(key, (old) => {
        if (!old) return old;
        previousProfile.current = {
          handle: old.handle ?? "",
          bio: old.bio ?? "",
          defaultVisibility: old.defaultVisibility ?? "grup",
        };
        return {
          ...old,
          ...(input.handle !== undefined ? { handle: input.handle } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.defaultVisibility !== undefined
            ? { defaultVisibility: input.defaultVisibility }
            : {}),
        };
      });
    },
    invalidate: () => [orpc.social.key()],
    success: () => {
      onOpenChange(false);
      onSaved();
      const prev = previousProfile.current;
      previousProfile.current = null;
      if (!prev) return { message: "Pengaturan feed tersimpan." };
      return {
        message: "Pengaturan feed tersimpan.",
        undo: () =>
          void client.social.updateProfile({
            handle: prev.handle || undefined,
            bio: prev.bio || undefined,
            defaultVisibility: prev.defaultVisibility,
          }),
      };
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const submit = () => {
    const clean = handle.trim().toLowerCase();
    if (clean.length > 0 && !HANDLE_REGEX.test(clean)) {
      setError("Handle 3-20 karakter, hanya huruf kecil, angka, dan _");
      return;
    }
    setError(null);
    update.mutate({
      handle: clean.length > 0 ? clean : undefined,
      bio: bio.trim(),
      defaultVisibility: visibility,
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Handle & bio"
      description="Tautan profilmu: joyorogo.com/u/handle"
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <FieldLabel>Handle</FieldLabel>
          <Input
            value={handle}
            onChange={(event) => setHandle(event.target.value.toLowerCase())}
            maxLength={20}
            placeholder="mis. budi_olahraga"
            aria-label="Handle"
          />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel>Bio</FieldLabel>
          <Textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={BIO_MAX}
            rows={2}
            placeholder="Ceritakan targetmu singkat..."
          />
        </label>
        <div className="space-y-1.5">
          <FieldLabel>Penonton bawaan saat membagikan</FieldLabel>
          <Segmented<Visibility>
            label="Visibility default"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: "grup", label: "Teman grup" },
              { value: "publik", label: "Publik" },
            ]}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <Button className="w-full" disabled={update.isPending} onClick={submit}>
          {update.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
      </div>
    </Sheet>
  );
}

function BlockList({ myId, onUnblock }: { myId: string | null; onUnblock: () => void }) {
  const blockList = useQuery(orpc.social.blockList.queryOptions());
  const unblock = useMutation(
    orpc.social.unblock.mutationOptions({
      onSuccess: () => {
        toast.success("Blokir dibuka.");
        onUnblock();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (blockList.isPending) {
    return <Skeleton className="h-24 rounded-2xl" />;
  }
  if (blockList.error) {
    return (
      <p role="alert" className="text-sm font-semibold text-destructive">
        {blockList.error.message}
      </p>
    );
  }
  const rows = blockList.data;
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Belum ada akun yang diblokir.
      </p>
    );
  }
  return (
    <ListGroup className="mt-1">
      {rows.map((row) => (
        <ListRow
          key={row.id}
          icon={<Avatar name={row.name} image={row.image} className="size-11" />}
          title={row.id === myId ? `${row.name} (kamu)` : row.name}
          subtitle={row.handle ? `@${row.handle}` : undefined}
          trailing={
            <Button
              variant="secondary"
              size="sm"
              disabled={unblock.isPending}
              onClick={() => unblock.mutate({ userId: row.id })}
            >
              Buka blokir
            </Button>
          }
        />
      ))}
    </ListGroup>
  );
}
