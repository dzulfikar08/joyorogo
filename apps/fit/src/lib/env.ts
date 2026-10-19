/**
 * Absolute API origin. Required: the app is a separate origin from the API, so there is no sensible default
 * ("/" would call this static host). A missing value fails at startup instead of on the first request.
 */
const raw = import.meta.env.VITE_SERVER_URL;
if (!raw || !/^https?:\/\//.test(raw)) {
  throw new Error("VITE_SERVER_URL must be an absolute http(s) URL, e.g. https://api.joyorogo.com");
}

export const SERVER_URL = raw.replace(/\/+$/, "");
export const DEV_LOGIN = import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === "1";
