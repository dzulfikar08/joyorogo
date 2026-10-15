import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mascot } from "@/components/mascot";
import { Page } from "@/components/kit/surface";
import { trackConversion } from "@/lib/analytics";
import { shareInvite } from "@/lib/group-invite";
import { orpc } from "@/utils/orpc";

type CreatedGroup = { id: string; name: string; inviteCode: string };

/**
 * Optional step after the plan-ready screen: start a group and send its
 * invite, or share one the person is already in. Reuses group.create, the
 * group list and the same share helper as the group screen. Never gates
 * anything: "Lewati" goes straight on.
 */
export function InviteFriendsStep({
  defaultName,
  onSkip,
  onOpenGroup,
}: {
  defaultName: string;
  /** Leaves the step; the caller continues to the app. */
  onSkip: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [created, setCreated] = useState<CreatedGroup | null>(null);
  const groups = useQuery(orpc.group.list.queryOptions());

  const create = useMutation(
    orpc.group.create.mutationOptions({
      onSuccess: (group) => {
        if (!group) return;
        queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        trackConversion("onboarding_group_created");
        setCreated({ id: group.id, name: group.name, inviteCode: group.inviteCode });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const share = (group: { name: string; inviteCode: string }) => {
    shareInvite(group.name, group.inviteCode).then(
      (result) => {
        if (result === "copied") toast.success("Teks undangan disalin, tinggal tempel di WhatsApp.");
      },
      () => toast.error("Gagal membagikan. Coba lagi sebentar ya."),
    );
  };

  const trimmed = name.trim();
  const existing = groups.data ?? [];

  return (
    <Page className="max-w-xl">
      <header className="px-1 pt-2 pb-6">
        <Mascot pose="cheer" size="md" eager className="mx-0 mb-3" />
        <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">
          {created ? "Grupmu sudah jadi" : "Ajak teman"}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {created
            ? "Kirim undangannya sekarang, teman yang gabung langsung kelihatan di grup."
            : "Catat kalori lebih gampang kalau ada yang ngecek. Bikin grup kecil, kirim tautannya, dan saling colek kalau ada yang lupa."}
        </p>
      </header>

      {created ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-3xl bg-card p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Users className="size-5 text-primary" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold">{created.name}</p>
              <p className="text-sm text-muted-foreground">Kode {created.inviteCode}</p>
            </div>
          </div>
          <Button className="w-full" size="lg" onClick={() => share(created)}>
            <Share2 aria-hidden />
            Bagikan undangan
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => onOpenGroup(created.id)}>
            Buka grup
          </Button>
          <Button variant="ghost" className="w-full" onClick={onSkip}>
            Nanti saja, buka Beranda
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length > 0) create.mutate({ name: trimmed });
          }}
        >
          <label className="block space-y-1.5">
            <span className="px-1 text-sm font-semibold">Nama grup</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              aria-label="Nama grup"
            />
          </label>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={trimmed.length === 0 || create.isPending}
          >
            {create.isPending ? "Membuat grup…" : "Buat grup"}
          </Button>

          {existing.length > 0 && (
            <section aria-label="Grup yang sudah ada" className="pt-3">
              <p className="px-1 pb-2 text-sm font-semibold text-muted-foreground">
                Atau bagikan grup yang sudah kamu ikuti
              </p>
              <ul className="space-y-2">
                {existing.slice(0, 3).map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3"
                  >
                    <span className="min-w-0 truncate font-semibold">{group.name}</span>
                    <Button type="button" size="sm" variant="secondary" onClick={() => share(group)}>
                      <Share2 aria-hidden />
                      Bagikan
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Button type="button" variant="ghost" className="w-full" onClick={onSkip}>
            Lewati, buka Beranda
          </Button>
        </form>
      )}
    </Page>
  );
}
