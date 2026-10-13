// Service worker for puasa intermiten Web Push reminders. Registered by the
// Profil settings when notifikasi is switched on. Kept cache-light: Cloudflare
// serves /sw.js with `Cache-Control: no-cache` (see public/_headers), so an
// updated worker is picked up on the next visit instead of after a year.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "JoyoRogo", body: "Pengingat puasa intermiten" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    // Payload bukan JSON yang kita kirim — tampilkan default saja.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "joyorogo-fasting",
      data: { url: "/beranda" },
    }),
  );
});

// Ketuk notifikasi → buka/fokus Beranda.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/beranda", self.location.origin).href;
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
