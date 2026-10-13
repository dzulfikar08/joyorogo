import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, isRedirect, Link, redirect, useNavigate } from "@tanstack/react-router";
import { CircleAlert, Users } from "lucide-react";
import { toast } from "sonner";

import { sessionQuery } from "@/lib/auth-client";
import { pageHead } from "@/lib/seo";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/gabung/$code")({
  component: GabungPage,
  head: () => pageHead("/gabung"),
  beforeLoad: async ({ context, params }) => {
    // Same gate as _auth, but with a return path: invite links usually arrive
    // before the person has an account (or before they signed in on this device).
    try {
      const session = await context.queryClient.ensureQueryData({
        ...sessionQuery,
        revalidateIfStale: true,
      });
      if (!session) {
        throw redirect({ to: "/login", search: { redirect: `/gabung/${params.code}` } });
      }
    } catch (error) {
      if (isRedirect(error)) throw error;
      // Network failure: show the page; the join attempt will surface the error.
    }
  },
});

function GabungPage() {
  const { code } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const valid = /^[A-Za-z0-9]{4,20}$/.test(code);
  const preview = useQuery({
    ...orpc.group.preview.queryOptions({ input: { code } }),
    enabled: valid,
    retry: false,
  });

  const join = useMutation(
    orpc.group.join.mutationOptions({
      onSuccess: ({ groupId }) => {
        queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        toast.success("Berhasil gabung!");
        void navigate({ to: "/grup/$groupId", params: { groupId } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <img src="/brand/logo-mark.svg" alt="" className="h-16 w-auto" />
        <div className="mt-6 w-full max-w-sm rounded-3xl bg-card p-6 text-center">
          {!valid ? (
            <>
              <CircleAlert className="mx-auto size-8 text-destructive" aria-hidden />
              <h1 className="mt-3 text-lg font-extrabold tracking-tight">Kode undangan tidak valid</h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Periksa lagi tautan atau kodenya, lalu coba buka sekali lagi.
              </p>
              <Button render={<Link to="/" />} variant="secondary" className="mt-5 w-full">
                Buka JoyoRogo
              </Button>
            </>
          ) : preview.isPending ? (
            <div aria-busy="true" aria-label="Memeriksa undangan">
              <Skeleton className="mx-auto h-12 w-12 rounded-full" />
              <Skeleton className="mx-auto mt-3 h-6 w-40" />
              <Skeleton className="mx-auto mt-2 h-4 w-24" />
              <Skeleton className="mx-auto mt-5 h-12 w-full rounded-full" />
            </div>
          ) : preview.isError ? (
            <>
              <CircleAlert className="mx-auto size-8 text-destructive" aria-hidden />
              <h1 className="mt-3 text-lg font-extrabold tracking-tight">
                {preview.error.message}
              </h1>
              <Button render={<Link to="/" />} variant="secondary" className="mt-5 w-full">
                Buka JoyoRogo
              </Button>
            </>
          ) : (
            <>
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Users className="size-6 text-primary" aria-hidden />
              </span>
              <h1 className="mt-3 text-xl font-extrabold tracking-tight">{preview.data.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {preview.data.memberCount} anggota
                {preview.data.alreadyMember ? " · kamu sudah gabung" : ""}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Gabung buat pantau kalori bareng, colek yang malas catat, dan intip perut lewat VAR.
              </p>
              <Button
                size="lg"
                className="mt-5 w-full"
                disabled={join.isPending}
                onClick={() => join.mutate({ code })}
              >
                {join.isPending
                  ? "Membuka grup…"
                  : preview.data.alreadyMember
                    ? "Buka grup"
                    : "Gabung"}
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
