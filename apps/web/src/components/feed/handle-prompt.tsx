import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Card } from "@/components/kit/surface";
import { useSession } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

const dismissKey = (userId: string) => `jrg-handle-prompt-${userId}`;

/**
 * Kartu sekali tampil untuk pengguna yang masih memakai handle sementara
 * (jr-xxxxxxxx). Cek ketersediaan langsung ke server; "Nanti saja" disimpan
 * di perangkat ini supaya tidak muncul lagi.
 */
export function HandlePrompt({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const profile = useQuery(orpc.social.myProfile.queryOptions());
  const [dismissed, setDismissed] = useState(true);
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");

  const needsPrompt = profile.data?.handleIsPlaceholder === true;

  useEffect(() => {
    if (userId) setDismissed(localStorage.getItem(dismissKey(userId)) === "1");
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim().toLowerCase()), 350);
    return () => clearTimeout(timer);
  }, [value]);

  const suggestions = useQuery({
    ...orpc.social.handleSuggestions.queryOptions(),
    enabled: needsPrompt && !dismissed,
    staleTime: 5 * 60 * 1000,
  });
  const check = useQuery({
    ...orpc.social.handleCheck.queryOptions({ input: { handle: debounced } }),
    enabled: needsPrompt && !dismissed && debounced.length > 0,
  });

  const save = useMutation({
    mutationFn: (handle: string) => client.social.updateProfile({ handle }),
    onSuccess: async () => {
      toast.success("Nama pengguna tersimpan.");
      await queryClient.invalidateQueries({ queryKey: orpc.social.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  if (!needsPrompt || dismissed) return null;

  const clean = value.trim().toLowerCase();
  const settled = clean.length > 0 && clean === debounced && !check.isFetching;
  const status = settled ? check.data : undefined;
  const canSave = status?.status === "free" && !save.isPending;

  const dismiss = () => {
    if (userId) localStorage.setItem(dismissKey(userId), "1");
    setDismissed(true);
  };

  return (
    <Card className={className} aria-label="Pilih nama pengguna">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AtSign className="size-5 text-makan" aria-hidden />
          <h2 className="text-base font-bold">Pilih nama pengguna</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="Tutup" onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Namamu di feed masih sementara ({profile.data?.handle}). Pilih yang kamu suka, ini jadi
        tautan profilmu.
      </p>

      <Input
        className="mt-3"
        value={value}
        onChange={(event) => setValue(event.target.value.toLowerCase())}
        maxLength={20}
        placeholder="mis. budi_olahraga"
        aria-label="Nama pengguna"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <p
        role="status"
        aria-live="polite"
        className={`mt-1.5 min-h-5 text-sm font-semibold ${
          status?.status === "free"
            ? "text-makan-ink"
            : status
              ? "text-destructive"
              : "text-muted-foreground"
        }`}
      >
        {clean.length === 0 ? (
          ""
        ) : !settled ? (
          "Mengecek..."
        ) : status?.status === "free" ? (
          <span className="inline-flex items-center gap-1">
            <Check className="size-4" aria-hidden /> Tersedia
          </span>
        ) : status?.status === "own" ? (
          "Ini sudah jadi namamu."
        ) : (
          status?.message
        )}
      </p>

      {suggestions.data && suggestions.data.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.data.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setValue(suggestion)}
              className="rounded-full bg-muted px-3 py-1.5 text-sm font-semibold text-foreground active:scale-[0.97]"
            >
              @{suggestion}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" disabled={!canSave} onClick={() => save.mutate(clean)}>
          {save.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
        <Button variant="ghost" onClick={dismiss}>
          Nanti saja
        </Button>
      </div>
    </Card>
  );
}
