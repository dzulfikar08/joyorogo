import { Link, useRouter } from "@tanstack/react-router";
import { ChevronDown, Home, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { ErrorComponentProps, NotFoundRouteProps } from "@tanstack/react-router";

// Chunk-load errors mean the user still has an old tab open while a new
// deploy replaced the built assets: only a full reload can recover.
function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /failed to fetch dynamically imported module|importing a module script|loading chunk \d+ failed|chunkloaderror/i.test(
    message,
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function Mascot({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={120}
      height={120}
      className="mx-auto h-28 w-28 select-none object-contain"
      draggable={false}
    />
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">{children}</div>;
}

const primaryButton =
  "pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold whitespace-nowrap text-primary-foreground hover:opacity-90";

const secondaryButton =
  "pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-6 text-sm font-semibold whitespace-nowrap text-foreground hover:bg-muted";

const homeLink =
  "pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground";

function Shell({
  children,
  status,
}: {
  children: React.ReactNode;
  status?: "404" | "500";
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12 text-center text-foreground">
      <div className="flex w-full max-w-md flex-col items-center">
        {status ? (
          <p className="text-xs font-bold tracking-[0.3em] text-muted-foreground uppercase">
            {status}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Router-level error screen. Deliberately provider-free: this renders even
 * when the query client or theme context itself is what broke. */
export function ErrorScreen({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const chunkError = isChunkLoadError(error);

  return (
    <Shell status={chunkError ? undefined : "500"}>
      <Mascot src="/mascot/surprised.webp" alt="Maskot JoyoRogo kaget" />
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">
        {chunkError ? "Versi baru tersedia" : "Waduh, ada yang error"}
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {chunkError
          ? "JoyoRogo baru saja diperbarui. Muat ulang halaman untuk memakai versi terbaru, ya."
          : "Ada yang salah di sisi kami. Tenang, datangmu aman. Coba lagi, atau muat ulang halaman kalau masih error."}
      </p>

      <Actions>
        {chunkError ? (
          <button type="button" className={primaryButton} onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" aria-hidden />
            Muat ulang sekarang
          </button>
        ) : (
          <button
            type="button"
            className={primaryButton}
            onClick={() => {
              // invalidate() re-runs loaders so stale data from before the
              // error is refetched before the component tree resets.
              void router.invalidate();
              reset();
            }}
          >
            <RefreshCw className="size-4" aria-hidden />
            Coba lagi
          </button>
        )}
        {!chunkError ? (
          <button type="button" className={secondaryButton} onClick={() => window.location.reload()}>
            Muat ulang halaman
          </button>
        ) : null}
        <Link to="/" className={homeLink}>
          <Home className="size-4" aria-hidden />
          Ke Beranda
        </Link>
      </Actions>

      <button
        type="button"
        className="mt-8 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
      >
        Detail teknis
        <ChevronDown
          className={`size-3.5 transition-transform ${showDetails ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {showDetails ? (
        <pre className="mt-3 max-h-40 w-full overflow-auto rounded-xl bg-muted p-3 text-left text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {errorMessage(error)}
        </pre>
      ) : null}
    </Shell>
  );
}

/** Router-level 404 screen. */
export function NotFoundScreen(_props: NotFoundRouteProps) {
  return (
    <Shell status="404">
      <Mascot src="/mascot/peek.webp" alt="Maskot JoyoRogo mengintip" />
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">
        Halaman tidak ditemukan
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Halaman yang kamu cari tidak ada atau sudah dipindah. Yuk kembali ke Beranda.
      </p>
      <Actions>
        <Link to="/" className={primaryButton}>
          <Home className="size-4" aria-hidden />
          Ke Beranda
        </Link>
      </Actions>
    </Shell>
  );
}
