import { Loader2 } from "lucide-react";

/** Router-level pending fallback: a quiet spinner on the paper canvas. */
export default function Loader() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Memuat">
      <Loader2
        className="size-6 animate-spin text-muted-foreground motion-reduce:animate-[spin_1.5s_linear_infinite]"
        aria-hidden
      />
    </div>
  );
}
