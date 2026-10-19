// Calls to the JoyoFit cloud API (api.fit.joyorogo.com, repo watch-fit `server/`): sleep stages and the watch face library.
// The session cookie is host-only on the JoyoRogo API, so a browser cannot send it to api.fit.joyorogo.com. These calls go to
// the JoyoRogo API's `/api/fit/*` instead (apps/server/src/fit-proxy.ts), which repeats them to the JoyoFit API with the same
// session. The screens word the errors themselves.

import { SERVER_URL } from "./env";
import { FitApiError } from "./fit-api-error";

export { FitApiError };

/** `path` is the JoyoFit API route without its `/v1`, e.g. `/sleep?from=...`. */
export async function fitApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await fitApiWithStatus<T>(path, init)).data;
}

/** The same, with the status of a success (a 200 and a 201 can mean different things: "already there" and "created"). */
export async function fitApiWithStatus<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: T }> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}/api/fit${path}`, {
      ...init,
      credentials: "include",
    });
  } catch {
    // Offline, blocked by CORS or the host is down: the same "cannot reach" to the person.
    throw new FitApiError(0, "network", null);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new FitApiError(response.status, (body as { error?: string } | null)?.error ?? "", body);
  }
  return { status: response.status, data: (await response.json()) as T };
}
