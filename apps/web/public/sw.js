// Service worker for Web Push (fasting reminders plus the notification
// categories from /profil/notifikasi). Registered when the user switches
// browser notifications on. Kept cache-light: Cloudflare serves /sw.js with
// `Cache-Control: no-cache` (see public/_headers), so an updated worker is
// picked up on the next visit instead of after a year.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    if (parsed && typeof parsed === "object") payload = parsed;
  } catch {
    // Payload bukan JSON — pakai default di bawah.
  }
  // Default fasting copy only when the server sent no title/body.
  const hasText = typeof payload.title === "string" && typeof payload.body === "string";
  const title = hasText ? payload.title : "JoyoRogo";
  const body = hasText ? payload.body : "Pengingat puasa intermiten";
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : "joyorogo-fasting";
  const url =
    typeof payload.url === "string" && payload.url
      ? payload.url
      : typeof payload.data?.url === "string" && payload.data.url
        ? payload.data.url
        : "/beranda";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag,
      data: { url },
    }),
  );
});

// Ketuk notifikasi → buka/fokus halaman tujuan (hanya same-origin).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target;
  try {
    target = new URL(event.notification.data?.url ?? "/beranda", self.location.origin);
  } catch {
    target = new URL("/beranda", self.location.origin);
  }
  if (target.origin !== self.location.origin) target = new URL("/beranda", self.location.origin);
  const url = target.href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
