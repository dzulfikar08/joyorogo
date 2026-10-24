// The Garmin Personal API client: GET with the bearer token minted from the user's key (lib/garmin-grant.ts). The official
// Python client lists every path (https://github.com/garmin/connect-personal-api-python); these are the ones JoyoRogo reads.

export const GARMIN_API = "https://personal.connectapi.garmin.com";
const TIMEOUT_MS = 10_000;
/** Activities one request returns at most (the page size JoyoRogo asks for). */
export const ACTIVITY_PAGE = 100;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetcher = (input, init) => fetch(input, init);

/** `unauthorized`: Garmin refused the token (expired or revoked). `unavailable`: Garmin or the network failed. */
export type GarminApiFailure = "unauthorized" | "unavailable";

export class GarminApiError extends Error {
  constructor(readonly failure: GarminApiFailure, detail: string) {
    super(`Garmin API: ${failure} (${detail})`);
    this.name = "GarminApiError";
  }
}

export class GarminClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = defaultFetch,
  ) {}

  /** The JSON of a path, or `null` for an empty answer. Errors name the path and status only, never a header. */
  private async get(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
    let response: Response;
    try {
      response = await this.fetcher(`${GARMIN_API}${path}${query ? `?${query}` : ""}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GarminApiError("unavailable", `${path} unreachable`);
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new GarminApiError("unauthorized", `${path} ${response.status}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new GarminApiError("unavailable", `${path} ${response.status}`);
    }
    const text = await response.text();
    if (text === "") return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GarminApiError("unavailable", `${path} not JSON`);
    }
  }

  /** One page of activity summaries between two days (inclusive), newest first. */
  activities(start: string, end: string, offset: number): Promise<unknown> {
    return this.get("/activitylist-service/activities/search/activities", {
      start: offset,
      limit: ACTIVITY_PAGE,
      startDate: start,
      endDate: end,
    });
  }

  weights(start: string, end: string): Promise<unknown> {
    return this.get(`/weight-service/weight/range/${start}/${end}`, { includeAll: "true" });
  }

  /** Daily summaries: steps, distance, calories, intensity minutes; up to 90 days in one request. */
  dailySummaries(start: string, end: string): Promise<unknown> {
    return this.get("/usersummary-service/v2/dailysummaries", { startDate: start, endDate: end });
  }
}
