import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Link2, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Avatar } from "@/components/avatar";
import { PostCard } from "@/components/feed/post-card";
import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { useSession } from "@/lib/auth-client";
import { shareUrl } from "@/lib/share-links";
import type { PublicProfileData } from "@/lib/api-types";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/u/$handle")({
  component: PublicProfilePage,
  head: () => ({ meta: [{ title: "Profil JoyoRogo" }] }),
});

function Skeletons() {
  return (
    <div className="mx-auto max-w-xl space-y-3 px-4 py-6" aria-busy="true" aria-label="Memuat profil">
      <Skeleton className="h-24 rounded-3xl" />
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="h-40 rounded-3xl" />
    </div>
  );
}

function FollowButton({ profile }: { profile: PublicProfileData }) {
  const queryClient = useQueryClient();
  const profileKey = orpc.social.publicProfile
    .queryOptions({ input: { handle: profile.handle ?? "", limit: 10 } })
    .queryKey;
  const follow = useOptimisticMutation<
    Parameters<AppRouterClient["social"]["setFollow"]>[0],
    unknown
  >({
    mutationFn: (input) => client.social.setFollow(input),
    patch: (input, cache) => {
      cache.value<{ isFollowing?: boolean; followersCount?: number }>(profileKey, (old) =>
        old
          ? {
              ...old,
              isFollowing: input.follow,
              followersCount: Math.max(
                0,
                (old.followersCount ?? 0) + (input.follow ? 1 : -1),
              ),
            }
          : old,
      );
    },
    invalidate: () => [orpc.social.key()],
    success: (input) =>
      input.follow
        ? {
            message: `Kamu mengikuti ${profile.name}`,
            undo: () => void client.social.setFollow({ userId: profile.userId, follow: false }),
          }
        : {
            message: `Berhenti mengikuti ${profile.name}`,
            undo: () => void client.social.setFollow({ userId: profile.userId, follow: true }),
          },
  });
  const active = profile.isFollowing === true;
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "default"}
      onClick={() => follow.mutate({ userId: profile.userId, follow: !active })}
    >
      {active ? (
        <UserCheck className="size-4" aria-hidden />
      ) : (
        <UserPlus className="size-4" aria-hidden />
      )}
      {active ? "Mengikuti" : "Ikuti"}
    </Button>
  );
}

function CopyLinkButton({ handle }: { handle: string }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-label="Salin tautan profil"
      onClick={() => {
        void navigator.clipboard.writeText(shareUrl(`/u/${handle}`, "profile"));
        toast.success("Tautan disalin.");
      }}
    >
      <Link2 className="size-4" aria-hidden />
    </Button>
  );
}

function PublicProfilePage() {
  const { handle } = Route.useParams();
  const session = useSession();
  const profile = useQuery(
    orpc.social.publicProfile.queryOptions({ input: { handle, limit: 10 } }),
  );

  if (profile.isPending) {
    return (
      <div className="flex min-h-svh flex-col">
        <PublicHeader />
        <main className="flex-1">
          <Skeletons />
        </main>
        <PublicFooter />
      </div>
    );
  }
  if (profile.error) {
    return (
      <div className="flex min-h-svh flex-col">
        <PublicHeader />
        <main className="flex-1">
          <div className="mx-auto max-w-xl px-4 py-16 text-center">
            <p className="text-lg font-extrabold">Profil tidak ditemukan</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tautannya salah, atau pemiliknya menutup profilnya.
            </p>
          </div>
        </main>
        <PublicFooter />
      </div>
    );
  }

  const data = profile.data;
  const posts = data.posts.items;
  const myId = session.data?.user.id ?? null;

  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-3 px-4 py-6">
        <section className="rounded-3xl bg-card p-5">
          <div className="flex items-center gap-4">
            <Avatar name={data.name} image={data.image} className="size-16" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-extrabold tracking-tight">{data.name}</h1>
              {data.handle && <p className="truncate text-sm text-muted-foreground">@{data.handle}</p>}
            </div>
            {data.publicProfile && (
              <span className="flex shrink-0 gap-1.5">
                <CopyLinkButton handle={handle} />
                {data.isFollowing !== null && <FollowButton profile={data} />}
              </span>
            )}
          </div>
          {data.bio && <p className="mt-3 text-sm text-foreground/90">{data.bio}</p>}
          {data.stats && (
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-xs text-muted-foreground">Postingan</dt>
                <dd className="text-lg font-extrabold tabular-nums">{data.stats.postCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pengikut</dt>
                <dd className="text-lg font-extrabold tabular-nums">{data.stats.followerCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Mengikuti</dt>
                <dd className="text-lg font-extrabold tabular-nums">{data.stats.followingCount}</dd>
              </div>
            </dl>
          )}
        </section>

        {!data.publicProfile ? (
          <EmptyHint title="Profil ini privat" pose="peek">
            {data.name} tidak membagikan progresnya ke publik.
          </EmptyHint>
        ) : posts.length === 0 ? (
          <EmptyHint title="Belum ada postingan publik" pose="relax">
            {data.isSelf
              ? "Bagikan makanan, latihan, atau progres beratmu lewat tombol Bagikan ke feed."
              : "Postingan publiknya akan muncul di sini."}
          </EmptyHint>
        ) : (
          posts.map((post) => (
            <PostCard key={post.id} post={post} isOwn={post.author.id === myId} />
          ))
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
