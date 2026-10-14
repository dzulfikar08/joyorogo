import { ChevronDown, Home, RefreshCw } from "lucide-react";
import { Component, useState, type ErrorInfo, type ReactNode } from "react";

// Chunk-load errors mean the browser still runs an old tab while a new
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

const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90";

const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-6 text-sm font-semibold text-foreground hover:bg-muted";

const homeLink =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold text-muted-foreground hover:text-foreground";

/** Full-page fallback for unexpected render errors in the admin console.
 * Plain tokens only: it must render even when providers themselves broke. */
export function AdminErrorScreen({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const chunkError = isChunkLoadError(error);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12 text-center text-foreground">
      <div className="flex w-full max-w-md flex-col items-center">
        {!chunkError ? (
          <p className="text-xs font-bold tracking-[0.3em] text-muted-foreground uppercase">
            500
          </p>
        ) : null}
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
          {chunkError ? "Versi baru tersedia" : "Waduh, ada yang error"}
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {chunkError
            ? "Admin console baru saja diperbarui. Muat ulang halaman untuk memakai versi terbaru."
            : "Ada yang salah di sisi kami. Coba lagi, atau muat ulang halaman kalau masih error."}
        </p>

        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          {chunkError ? (
            <button
              type="button"
              className={primaryButton}
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="size-4" aria-hidden />
              Muat ulang sekarang
            </button>
          ) : (
            <button type="button" className={primaryButton} onClick={reset}>
              <RefreshCw className="size-4" aria-hidden />
              Coba lagi
            </button>
          )}
          {!chunkError ? (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => window.location.reload()}
            >
              Muat ulang halaman
            </button>
          ) : null}
          <a href="/" className={homeLink}>
            <Home className="size-4" aria-hidden />
            Ke Beranda
          </a>
        </div>

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
      </div>
    </div>
  );
}

/** Last-resort boundary: no provider above it, so it always renders. */
export class AdminErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Admin render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <AdminErrorScreen error={this.state.error} reset={() => this.setState({ error: null })} />
      );
    }
    return this.props.children;
  }
}
