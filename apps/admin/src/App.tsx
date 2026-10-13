import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { Moon, RotateCw, Sun } from "lucide-react";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { api } from "./api";
import { useAdminGate, useSignIn, useSignOut } from "./auth";
import { Badge } from "./ui";
import { useTheme } from "./theme";
import { OrdersSection } from "./sections/Orders";
import { OverviewSection, SendTestEmailButton } from "./sections/Overview";
import { UsersSection } from "./sections/Users";

/** Sun/Moon header toggle: switches light/dark; system default until first pick. */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={dark ? "Mode terang" : "Mode gelap"}
      title={dark ? "Mode terang" : "Mode gelap"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

const TABS = ["overview", "users", "orders"] as const;
type Tab = (typeof TABS)[number];

function currentTab(): Tab {
  const hash = window.location.hash.replace(/^#/, "").split("?")[0];
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : "overview";
}

function SignInScreen({ notAdmin, email }: { notAdmin: boolean; email: string | null }) {
  const signIn = useSignIn();
  const signOut = useSignOut();

  if (notAdmin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold">Akun ini bukan admin</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {email ?? "unknown"}. Keluar lalu masuk dengan akun admin.
        </p>
        <Button variant="outline" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold">JoyoRogo Admin</h1>
      <p className="text-sm text-muted-foreground">Masuk dengan akun Google admin.</p>
      <Button onClick={() => signIn.mutate()} disabled={signIn.isPending}>
        Continue with Google
      </Button>
      {signIn.isError && <p className="text-sm text-destructive">{String(signIn.error)}</p>}
    </div>
  );
}

export default function App() {
  const gate = useAdminGate();
  const signOut = useSignOut();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(currentTab);
  const fetching = useIsFetching();
  const [updated, setUpdated] = useState(() => new Date());

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // "Updated" stamp refreshes whenever a fetch cycle completes.
  useEffect(() => {
    if (fetching === 0) setUpdated(new Date());
  }, [fetching]);

  const updatedTime = [updated.getHours(), updated.getMinutes(), updated.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

  if (gate.isPending) {
    return <div className="min-h-dvh" />;
  }
  if (gate.data && gate.data.state !== "admin") {
    return (
      <>
        <SignInScreen notAdmin={gate.data.state === "not-admin"} email={gate.data.email ?? null} />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img src="/brand/logo-mark.svg" alt="JoyoRogo" className="size-8" />
            <h1 className="text-lg font-bold">JoyoRogo Admin</h1>
            <Badge tone="green">Admin</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              Diperbarui {updatedTime}
            </span>
            <Button
              size="sm"
              variant="outline"
              aria-label="Refresh data"
              onClick={() => void queryClient.invalidateQueries()}
            >
              <RotateCw className={cn("size-4", fetching > 0 && "animate-spin")} />
              Refresh
            </Button>
            <SendTestEmailButton />
            <ThemeToggle />
            <span className="text-xs text-muted-foreground">{gate.data?.email ?? ""}</span>
            <Button
              size="xs"
              variant="ghost"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Sign out
            </Button>
          </div>
        </header>

        <nav className="flex gap-1 self-start rounded-full border border-border bg-card p-1">
          {TABS.map((t) => (
            <a
              key={t}
              href={`#${t}`}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold capitalize",
                tab === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </a>
          ))}
        </nav>

        <main className="pb-8">
          {tab === "overview" && <OverviewSection />}
          {tab === "users" && <UsersSection />}
          {tab === "orders" && <OrdersSection />}
        </main>
      </div>
      <Toaster />
    </>
  );
}
