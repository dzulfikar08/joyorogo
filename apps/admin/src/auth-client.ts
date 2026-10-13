import { createAuthClient } from "better-auth/react";

// Cloudflare Workers + Hono + better-auth on the main API; the Google OAuth
// cookie lives on that origin, so every request must send credentials there.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? "https://api.joyorogo.com").replace(
  /\/$/,
  "",
);

export const authClient = createAuthClient({ baseURL: SERVER_URL });

export function googleSignIn() {
  return authClient.signIn.social({
    provider: "google",
    callbackURL: window.location.origin,
  });
}
