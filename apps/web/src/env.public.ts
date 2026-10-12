// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const env = {
  VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL,
  VITE_DEV_LOGIN: import.meta.env.VITE_DEV_LOGIN,
} satisfies Pick<PublicCoercedEnvSchema, "VITE_SERVER_URL" | "VITE_DEV_LOGIN">;
