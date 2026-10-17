import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bell, ChevronRight, KeyRound, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("grup");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("list.loading")}>
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
  const { t } = useTranslation("grup");
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
        toast.success(t("create.toast"));
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
        toast.success(t("join.toast"));
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
      toast.error(t("join.codeLength"));
      return;
    }
    setPreviewCode(trimmed);
  };

  return (
    <Page className="max-w-xl">
      <PageHeader
        title={t("list.title")}
        subtitle={t("list.subtitle")}
        action={
          <Link
            to="/inbox"
            aria-label={
              unread.data?.count
                ? t("list.inboxUnread", { count: unread.data.count })
                : t("list.inbox")
            }
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
        <section aria-label={t("list.listLabel")} className="mt-1">
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
                    ? t("list.row.owner", { count: group.memberCount })
                    : t("members", { count: group.memberCount })
                }
              />
            ))}
          </ListGroup>
        </section>
      )}

      {groups.data && groups.data.length === 0 && (
        <div className="mt-1">
          <EmptyHint title={t("list.empty.title")} pose="cheer">
            {t("list.empty.body")}
          </EmptyHint>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t("list.create")}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setJoinOpen(true)}>
          <KeyRound className="size-4" aria-hidden />
          {t("list.join")}
        </Button>
      </div>

      <Sheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("create.title")}
        description={t("create.limits")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ name });
          }}
          className="space-y-4"
        >
          <Input
            aria-label={t("create.nameLabel")}
            placeholder={t("create.namePlaceholder")}
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" className="w-full" disabled={create.isPending || name.trim() === ""}>
            {create.isPending ? t("create.pending") : t("create.submit")}
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
        title={t("join.title")}
        description={t("join.hint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            checkCode();
          }}
          className="space-y-4"
        >
          <Input
            aria-label={t("join.codeLabel")}
            placeholder={t("join.codePlaceholder")}
            autoCapitalize="characters"
            maxLength={20}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Button type="submit" variant="secondary" className="w-full" disabled={code.trim() === ""}>
            {t("join.check")}
          </Button>
        </form>
        {previewCode !== null && (
          <div className="mt-4 rounded-2xl bg-muted p-4">
            {preview.isPending && <p className="text-sm text-muted-foreground">{t("join.checking")}</p>}
            {preview.isError && (
              <p className="text-sm font-semibold text-destructive">{preview.error.message}</p>
            )}
            {preview.data && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{preview.data.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("members", { count: preview.data.memberCount })}
                  </p>
                </div>
                {preview.data.alreadyMember ? (
                  <p className="max-w-[10rem] text-right text-xs font-semibold text-muted-foreground">
                    {t("join.alreadyMember")}
                  </p>
                ) : (
                  <Button onClick={() => join.mutate({ code: previewCode })} disabled={join.isPending}>
                    {join.isPending ? t("join.pending") : t("join.submit")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>

      <details className="group mt-6 px-2 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
          {t("how.title")}
        </summary>
        <p className="mt-1.5 pl-5.5">{t("how.body")}</p>
      </details>
    </Page>
  );
}
