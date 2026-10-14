import { Input } from "@joyorogo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import type { FastingPattern } from "@joyorogo/api/lib/fasting";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Card, Segmented } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type FastingSettings = {
  pattern: "off" | FastingPattern;
  windowStart: string;
  notify: boolean;
};

type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const PATTERN_OPTIONS: Array<{ value: FastingSettings["pattern"]; label: string }> = [
  { value: "off", label: "Mati" },
  { value: "16:8", label: "16:8" },
  { value: "18:6", label: "18:6" },
  { value: "20:4", label: "20:4" },
  { value: "omad", label: "OMAD" },
];

const FASTING_HINT: Record<FastingSettings["pattern"], string> = {
  off: "Pilih pola 16:8, 18:6, 20:4, atau OMAD untuk mulai. Mode Ramadan tetap didahulukan.",
  "16:8": "Puasa 16 jam, makan dalam jendela 8 jam.",
  "18:6": "Puasa 18 jam, makan dalam jendela 6 jam.",
  "20:4": "Puasa 20 jam, makan dalam jendela 4 jam.",
  omad: "Sekali makan sehari di dalam jendela ±1 jam.",
};

/** PushManager.applicationServerKey accepts a base64url string, but
 * BufferSource is the portable form across browsers. */
function base64UrlToUint8Array(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const raw = atob(padded + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Permission → /sw.js → VAPID subscribe → simpan ke server. */
async function subscribeBrowser(
  queryClient: QueryClient,
  subscribePush: (input: PushSubscriptionInput) => Promise<unknown>,
): Promise<boolean> {
  try {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      toast.error("Browser ini belum mendukung notifikasi push.");
      return false;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error("Izin notifikasi tidak diberikan.");
      return false;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const { key } = await queryClient.fetchQuery(orpc.fasting.vapidPublicKey.queryOptions());
    if (!key) {
      toast.error("Server belum siap mengirim notifikasi. Coba lagi nanti.");
      return false;
    }
    let subscription = await registration.pushManager.getSubscription();
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(key),
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      toast.error("Browser tidak mengirim kunci langganan.");
      return false;
    }
    await subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return true;
  } catch {
    toast.error("Gagal memasang notifikasi.");
    return false;
  }
}

async function unsubscribeBrowser(
  unsubscribePush: (input: { endpoint: string }) => Promise<unknown>,
): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const { endpoint } = subscription.toJSON();
    await subscription.unsubscribe();
    if (endpoint) await unsubscribePush({ endpoint });
  } catch {
    // Unsubscribe best-effort — server row dibiarkan sampai 404/410.
  }
}

/**
 * "Puasa intermiten" setelan di /profil: pola, jam buka jendela, dan toggle
 * notifikasi Web Push (izin → /sw.js → langganan VAPID).
 */
export function FastingSettingsSection() {
  const queryClient = useQueryClient();
  const settings = useQuery(orpc.fasting.settings.queryOptions());

  // Previous settings for the undo re-apply.
  const previousSettings = useRef<Awaited<ReturnType<AppRouterClient["fasting"]["settings"]>> | null>(null);
  const save = useOptimisticMutation<
    Parameters<AppRouterClient["fasting"]["setSettings"]>[0],
    unknown
  >({
    mutationFn: (input) => client.fasting.setSettings(input),
    patch: (input, cache) => {
      const key = orpc.fasting.settings.queryOptions().queryKey;
      previousSettings.current = queryClient.getQueryData(key) ?? null;
      cache.value(key, (old) => (old ? { ...old, ...input } : old));
    },
    invalidate: () => [orpc.fasting.key()],
    success: () => {
      const prev = previousSettings.current;
      previousSettings.current = null;
      if (!prev) return { message: "Pengaturan puasa disimpan" };
      return {
        message: "Pengaturan puasa disimpan",
        undo: () =>
          void client.fasting.setSettings({
            pattern: prev.pattern,
            windowStart: prev.windowStart,
            notify: prev.notify,
          }),
      };
    },
  });
  const subscribePush = useMutation(
    orpc.fasting.subscribePush.mutationOptions({
      onError: (error) => toast.error(error.message),
    }),
  );
  const unsubscribePush = useMutation(orpc.fasting.unsubscribePush.mutationOptions());

  const data = settings.data;
  if (settings.isPending || !data) {
    return (
      <Card>
        <div className="h-9 animate-pulse rounded-full bg-muted" />
        <div className="mt-4 h-11 animate-pulse rounded-xl bg-muted" />
      </Card>
    );
  }

  const pattern = data.pattern;
  const windowStart = data.windowStart;
  const notify = data.notify;

  const change = (patch:
    | { pattern: FastingSettings["pattern"] }
    | { windowStart: string }
    | { notify: boolean }) => {
    save.mutate({ ...data, ...patch });
  };

  const toggleNotify = async (enabled: boolean) => {
    if (enabled) {
      const ok = await subscribeBrowser(queryClient, subscribePush.mutateAsync);
      // Mirrors native: the switch only stays on when permission was granted.
      change({ notify: ok });
      return;
    }
    change({ notify: false });
    await unsubscribeBrowser(unsubscribePush.mutateAsync);
  };

  return (
    <Card>
      <Segmented
        label="Pola puasa intermiten"
        value={pattern}
        onChange={(value) => change({ pattern: value })}
        options={PATTERN_OPTIONS}
      />
      <div className="mt-4 flex items-center gap-3">
        <label
          htmlFor="fasting-window-start"
          className="shrink-0 text-sm font-semibold text-muted-foreground"
        >
          Jendela makan buka
        </label>
        <Input
          id="fasting-window-start"
          type="time"
          value={windowStart}
          disabled={pattern === "off" || save.isPending}
          onChange={(event) => {
            const value = event.target.value;
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) change({ windowStart: value });
          }}
          className="w-32"
        />
      </div>
      <div className="mt-4 flex min-h-[2.75rem] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="size-4 text-makan" aria-hidden />
            Notifikasi pengingat
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Web Push saat jendela buka, waktu makan, dan 30 menit sebelum tutup.
          </p>
        </div>
        <Switch
          checked={notify}
          onCheckedChange={(value) => void toggleNotify(value)}
          disabled={save.isPending || pattern === "off"}
          label="Notifikasi pengingat puasa intermiten"
        />
      </div>
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        {FASTING_HINT[pattern]}
      </p>
    </Card>
  );
}
