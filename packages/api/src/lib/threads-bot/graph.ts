// Threads Graph API calls the mention bot makes (https://developers.facebook.com/docs/threads): OAuth, token refresh,
// reading the mentions edge and single posts, publishing a reply, fetching an image into memory. Patterns follow
// atur (apps/app/src/worker/lib/threads.ts) and intip (src/worker/threads/client.ts). Plain fetch, so a test stubs
// globalThis.fetch.

const GRAPH = "https://graph.threads.net";
const API = `${GRAPH}/v1.0`;
const TIMEOUT_MS = 10_000;
const PUBLISH_RETRY_MS = 4_000;

/**
 * threads_basic reads posts; manage_mentions the mentions edge; read_replies the reply fields (is_reply, replied_to, root_post);
 * manage_replies is what reply_to_id needs and content_publish the threads_publish call (Meta's "Create Replies" page lists both).
 */
export const THREADS_SCOPES = [
  "threads_basic",
  "threads_manage_mentions",
  "threads_read_replies",
  "threads_manage_replies",
  "threads_content_publish",
] as const;

export class ThreadsApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  constructor(message: string, status: number, code: number | null) {
    super(`Threads: ${message}`);
    this.name = "ThreadsApiError";
    this.status = status;
    this.code = code;
  }
}

/** A post as the mentions edge, a single-post read and the webhook all return it (snake_case, as Meta sends it). */
export type ThreadsMedia = {
  id: string;
  username?: string;
  text?: string;
  /** TEXT_POST, IMAGE, VIDEO, CAROUSEL_ALBUM, AUDIO or REPOST_FACADE. */
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  is_reply?: boolean;
  is_quote_post?: boolean;
  replied_to?: { id: string };
  root_post?: { id: string; owner_id?: string; username?: string };
  /** Carousel only: the child posts (ids; media_type and media_url when expanded). */
  children?: { data?: { id: string; media_type?: string; media_url?: string }[] };
};

// children is requested by id only: the doc'd way to read a child is GET /{child-id}?fields=media_type,media_url.
export const MEDIA_FIELDS =
  "id,username,media_type,media_url,permalink,timestamp,is_reply,is_quote_post,replied_to,root_post,children";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new ThreadsApiError(error instanceof Error ? error.message : "network error", 0, null);
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; code?: number };
  } | null;
  if (!res.ok || body?.error) {
    throw new ThreadsApiError(
      body?.error?.message ?? `HTTP ${res.status}`,
      res.status,
      body?.error?.code ?? null,
    );
  }
  return body as T;
}

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

export type ThreadsToken = { accessToken: string; expiresIn: number };

export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  return `https://threads.net/oauth/authorize?${query({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: THREADS_SCOPES.join(","),
    response_type: "code",
    state,
  })}`;
}

/** Authorization code, then short-lived token (1 hour), then long-lived token (60 days). */
export async function exchangeCode(
  appId: string,
  appSecret: string,
  redirectUri: string,
  code: string,
): Promise<ThreadsToken> {
  const short = await call<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: FORM,
    body: query({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      // Meta appends "#_" to the code in the redirect.
      code: code.replace(/#_$/, ""),
    }),
  });
  const long = await call<{ access_token: string; expires_in: number }>(
    `${GRAPH}/access_token?${query({
      grant_type: "th_exchange_token",
      client_secret: appSecret,
      access_token: short.access_token,
    })}`,
  );
  return { accessToken: long.access_token, expiresIn: long.expires_in };
}

/** A long-lived token older than 24 hours can be refreshed for another 60 days. */
export async function refreshToken(accessToken: string): Promise<ThreadsToken> {
  const res = await call<{ access_token: string; expires_in: number }>(
    `${GRAPH}/refresh_access_token?${query({ grant_type: "th_refresh_token", access_token: accessToken })}`,
  );
  return { accessToken: res.access_token, expiresIn: res.expires_in };
}

export function getMe(accessToken: string): Promise<{ id: string; username: string }> {
  return call(`${API}/me?${query({ fields: "id,username", access_token: accessToken })}`);
}

export function getMedia(
  accessToken: string,
  mediaId: string,
  fields = MEDIA_FIELDS,
): Promise<ThreadsMedia> {
  return call(
    `${API}/${encodeURIComponent(mediaId)}?${query({ fields, access_token: accessToken })}`,
  );
}

/**
 * GET /{user-id}/mentions since a unix-seconds cursor, newest first, following the paging cursor up to `maxPages`.
 * Without advanced access to threads_manage_mentions Meta returns only mentions by testers of the app.
 */
export async function listMentions(
  accessToken: string,
  userId: string,
  since: number,
  maxPages = 3,
): Promise<ThreadsMedia[]> {
  const out: ThreadsMedia[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await call<{
      data?: ThreadsMedia[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>(
      `${API}/${encodeURIComponent(userId)}/mentions?${query({
        fields: MEDIA_FIELDS,
        since: String(since),
        limit: "50",
        access_token: accessToken,
        ...(after ? { after } : {}),
      })}`,
    );
    out.push(...(res.data ?? []));
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

/** Posts a text reply under `replyToId`: create a container with reply_to_id, then publish it. Returns our reply's media id. */
export async function publishReply(
  accessToken: string,
  userId: string,
  replyToId: string,
  text: string,
  retryMs = PUBLISH_RETRY_MS,
): Promise<string> {
  const container = await call<{ id: string }>(`${API}/${encodeURIComponent(userId)}/threads`, {
    method: "POST",
    headers: FORM,
    body: query({ media_type: "TEXT", text, reply_to_id: replyToId, access_token: accessToken }),
  });
  const publish = () =>
    call<{ id: string }>(`${API}/${encodeURIComponent(userId)}/threads_publish`, {
      method: "POST",
      headers: FORM,
      body: query({ creation_id: container.id, access_token: accessToken }),
    });
  // Meta suggests waiting for the container; a text container is normally ready at once, so one short retry covers the rest.
  const published = await publish().catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    return publish();
  });
  return published.id;
}

/** Hosts Threads serves post images from. A URL anywhere else is not fetched. */
const IMAGE_HOSTS = [
  "cdninstagram.com",
  "fbcdn.net",
  "threads.net",
  "threads.com",
  "instagram.com",
];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function isThreadsImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      IMAGE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

/** The photo's bytes, read into memory for one scan: never written anywhere. Throws when it is not a plain image under 8 MB. */
export async function fetchImage(url: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  if (!isThreadsImageUrl(url)) throw new ThreadsApiError("image host not allowed", 0, null);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new ThreadsApiError(error instanceof Error ? error.message : "network error", 0, null);
  }
  if (!res.ok) throw new ThreadsApiError(`image HTTP ${res.status}`, res.status, null);
  const mimeType =
    res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "image/jpeg";
  if (!mimeType.startsWith("image/"))
    throw new ThreadsApiError(`not an image (${mimeType})`, 0, null);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new ThreadsApiError("image too large", 0, null);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ThreadsApiError("image too large", 0, null);
  return { bytes, mimeType };
}
