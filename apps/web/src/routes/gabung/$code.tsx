import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, Users } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/lib/auth-client";
import { pageHead } from "@/lib/seo";
import { orpc } from "@/utils/orpc";

// No auth gate: a friend who taps the link should see which group invited
// them before being asked to sign in. Only joining needs a session.
export const Route = createFileRoute("/gabung/$code")({
  component: GabungPage,
  head: () => pageHead("/gabung"),
});

function GabungPage() {
  const { code } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useSession();

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

  const signedIn = Boolean(session.data);

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
              <p className="mt-3 text-sm font-semibold text-muted-foreground">
                {preview.data.alreadyMember ? "Grupmu" : "Kamu diundang ke"}
              </p>
              <h1 className="mt-0.5 text-xl font-extrabold tracking-tight text-balance">
                {preview.data.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {preview.data.memberCount} anggota
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Gabung buat pantau kalori bareng, colek yang malas catat, dan intip perut lewat VAR.
              </p>
              {session.isPending ? (
                <Skeleton className="mt-5 h-12 w-full rounded-full" />
              ) : signedIn ? (
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
              ) : (
                <>
                  <Button
                    size="lg"
                    className="mt-5 w-full"
                    render={<Link to="/login" search={{ redirect: `/gabung/${code}` }} />}
                  >
                    Masuk untuk gabung
                  </Button>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Masuk dengan Google, lalu kamu balik ke sini dan tinggal ketuk Gabung.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
