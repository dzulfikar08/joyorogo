import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import {
  FileText,
  Flag,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageSquareText,
  Moon,
  Receipt,
  RotateCw,
  Sun,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@joyorogo/ui/lib/utils";
import { useSendTestEmail } from "./account-actions";
import { useAdminGate, useSignIn, useSignOut } from "./auth";
import { Badge, Button } from "./ui";
import { useTheme } from "./theme";
import { OrdersSection } from "./sections/Orders";
import { FeedbackSection } from "./sections/Feedback";
import { LaporanSection } from "./sections/Laporan";
import { OverviewSection } from "./sections/Overview";
import { ReportsSection } from "./sections/Reports";
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

const TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "orders", label: "Orders", icon: Receipt },
  { id: "reports", label: "Reports", icon: Flag },
  { id: "feedback", label: "Feedback", icon: MessageSquareText },
  { id: "laporan", label: "Laporan", icon: FileText },
];
type Tab = (typeof TABS)[number]["id"];

function currentTab(): Tab {
  const hash = window.location.hash.replace(/^#/, "").split("?")[0];
  return TABS.some((t) => t.id === hash) ? hash : "overview";
}

const clock = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

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
      <img src="/brand/logo-mark.svg" alt="" className="size-12" />
      <h1 className="text-xl font-bold">JoyoRogo Admin</h1>
      <p className="text-sm text-muted-foreground">Masuk dengan akun Google admin.</p>
      <Button onClick={() => signIn.mutate()} disabled={signIn.isPending}>
        Continue with Google
      </Button>
      {signIn.isError && <p className="text-sm text-destructive">{String(signIn.error)}</p>}
    </div>
  );
}

const menuItem =
  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm outline-none data-highlighted:bg-muted data-disabled:opacity-50";

/** Phone-only account menu: who is signed in, test email, sign out. */
function AccountMenu({ email, updated }: { email: string; updated: string }) {
  const signOut = useSignOut();
  const testEmail = useSendTestEmail();
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        render={
          <Button size="icon" variant="ghost" aria-label="Akun">
            <UserRound className="size-5" />
          </Button>
        }
      />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner align="end" sideOffset={4} className="z-50 outline-none">
          <MenuPrimitive.Popup className="w-[min(18rem,calc(100dvw-1.5rem))] rounded-xl border border-border bg-card p-1 text-popover-foreground shadow-lg outline-none">
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium">{email || "Admin"}</p>
              <p className="text-xs text-muted-foreground tabular-nums">Diperbarui {updated} WIB</p>
            </div>
            <div className="my-1 h-px bg-border" />
            <MenuPrimitive.Item
              className={menuItem}
              disabled={testEmail.sending}
              onClick={() => void testEmail.send()}
            >
              <Mail className="size-4" />
              {testEmail.sending ? "Sending…" : "Send test email"}
            </MenuPrimitive.Item>
            <MenuPrimitive.Item
              className={menuItem}
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              <LogOut className="size-4" />
              Sign out
            </MenuPrimitive.Item>
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export default function App() {
  const gate = useAdminGate();
  const signOut = useSignOut();
  const testEmail = useSendTestEmail();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(currentTab);
  const fetching = useIsFetching();
  const [updated, setUpdated] = useState(() => new Date());

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  // "Updated" stamp refreshes whenever a fetch cycle completes.
  useEffect(() => {
    if (fetching === 0) setUpdated(new Date());
  }, [fetching]);

  const updatedTime = clock.format(updated);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const email = gate.data?.email ?? "";

  if (gate.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-label="Memuat">
        <img src="/brand/logo-mark.svg" alt="" className="size-10 animate-pulse" />
      </div>
    );
  }
  if (gate.data && gate.data.state !== "admin") {
    return (
      <>
        <SignInScreen notAdmin={gate.data.state === "not-admin"} email={gate.data.email ?? null} />
        <Toaster />
      </>
    );
  }

  const refresh = () => void queryClient.invalidateQueries();

  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 p-4 pb-24 md:p-6 md:pb-8">
        {/* Phones: slim sticky top bar. */}
        <header className="sticky top-0 z-30 -mx-4 -mt-4 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur md:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/brand/logo-mark.svg" alt="JoyoRogo" className="size-8 shrink-0" />
            <h1 className="truncate text-base font-bold">{active.label}</h1>
          </div>
          <div className="flex items-center">
            <Button size="icon" variant="ghost" aria-label="Refresh data" onClick={refresh}>
              <RotateCw className={cn("size-4", fetching > 0 && "animate-spin")} />
            </Button>
            <ThemeToggle />
            <AccountMenu email={email} updated={updatedTime} />
          </div>
        </header>

        {/* Tablet and up: full header. */}
        <header className="hidden flex-wrap items-center justify-between gap-3 md:flex">
          <div className="flex items-center gap-2.5">
            <img src="/brand/logo-mark.svg" alt="JoyoRogo" className="size-8" />
            <h1 className="text-lg font-bold">JoyoRogo Admin</h1>
            <Badge tone="green">Admin</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              Diperbarui {updatedTime} WIB
            </span>
            <Button size="sm" variant="outline" aria-label="Refresh data" onClick={refresh}>
              <RotateCw className={cn("size-4", fetching > 0 && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={testEmail.sending}
              onClick={() => void testEmail.send()}
            >
              {testEmail.sending ? "Sending…" : "Send test email"}
            </Button>
            <ThemeToggle />
            <span className="text-xs text-muted-foreground">{email}</span>
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

        <nav
          aria-label="Bagian"
          className="hidden gap-1 self-start rounded-full border border-border bg-card p-1 md:flex"
        >
          {TABS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </a>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          {tab === "overview" && <OverviewSection />}
          {tab === "users" && <UsersSection />}
          {tab === "orders" && <OrdersSection />}
          {tab === "reports" && <ReportsSection />}
          {tab === "feedback" && <FeedbackSection />}
          {tab === "laporan" && <LaporanSection />}
        </main>
      </div>

      {/* Phones: bottom tabs. */}
      <nav
        aria-label="Bagian"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold",
              tab === t.id ? "text-primary" : "text-muted-foreground",
            )}
          >
            <t.icon className="size-5" aria-hidden />
            {t.label}
          </a>
        ))}
      </nav>
      <Toaster mobileOffset={{ bottom: "5rem" }} />
    </>
  );
}
