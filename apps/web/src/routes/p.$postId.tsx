import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { i18n } from "@joyorogo/i18n";
import { PostCard } from "@/components/feed/post-card";
import { RouteMapPreview } from "@/components/feed/route-map-preview";
import { PublicFooter } from "@/components/public-footer";
import { WatchDetail } from "@/components/feed/watch-detail";
import { PublicHeader } from "@/components/public-header";
import { postPhotoUrl } from "@/components/sticker";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/p/$postId")({
  component: PostDetailPage,
  head: () => ({ meta: [{ title: i18n.t("feed:postPage.title") }] }),
});

function DetailSkeleton() {
  const { t } = useTranslation("feed");
  return (
    <div
      className="mx-auto max-w-xl space-y-3 px-4 py-6"
      aria-busy="true"
      aria-label={t("postPage.loading")}
    >
      <Skeleton className="h-48 rounded-3xl" />
    </div>
  );
}

/** Detail satu postingan; publik kalau visibility-nya 'publik'. */
function PostDetailPage() {
  const { t } = useTranslation("feed");
  const { postId } = Route.useParams();
  const post = useQuery(orpc.social.post.queryOptions({ input: { id: postId } }));

  // Pratinjau share: foto pertama post publik sebagai og:image (SPA — crawler
  // statis tetap memakai og.png bawaan, ini melengkapi untuk pra-render UI).
  useEffect(() => {
    const data = post.data;
    if (!data || data.visibility !== "publik" || data.photoCount === 0) return;
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:image");
    meta.setAttribute("content", postPhotoUrl(data.id));
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [post.data]);

  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {post.isPending ? (
          <DetailSkeleton />
        ) : post.error ? (
          <div className="py-16 text-center">
            <p className="text-lg font-extrabold">{t("postPage.notFound.title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("postPage.notFound.body")}</p>
          </div>
        ) : (
          // Komentar dan aksi jalan lewat kartu yang sama seperti di feed.
          <>
            <PostCard post={post.data} isOwn={false} hideMap={!!post.data.mapLine} />
            {post.data.kind === "latihan" && post.data.mapLine && (
              <RouteMapPreview
                line={post.data.mapLine}
                title={post.data.title}
                size="detail"
                className="mt-4"
              />
            )}
            {post.data.stats?.hasDetail === 1 && <WatchDetail postId={post.data.id} />}
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
