import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PostCard } from "@/components/feed/post-card";
import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/p/$postId")({
  component: PostDetailPage,
  head: () => ({ meta: [{ title: "Postingan JoyoRogo" }] }),
});

function DetailSkeleton() {
  return (
    <div
      className="mx-auto max-w-xl space-y-3 px-4 py-6"
      aria-busy="true"
      aria-label="Memuat postingan"
    >
      <Skeleton className="h-48 rounded-3xl" />
    </div>
  );
}

/** Detail satu postingan; publik kalau visibility-nya 'publik'. */
function PostDetailPage() {
  const { postId } = Route.useParams();
  const post = useQuery(orpc.social.post.queryOptions({ input: { id: postId } }));

  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {post.isPending ? (
          <DetailSkeleton />
        ) : post.error ? (
          <div className="py-16 text-center">
            <p className="text-lg font-extrabold">Postingan tidak ditemukan</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Mungkin sudah dihapus, atau cuma terlihat oleh teman grupnya.
            </p>
          </div>
        ) : (
          // Komentar dan aksi jalan lewat kartu yang sama seperti di feed.
          <PostCard post={post.data} isOwn={false} />
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
