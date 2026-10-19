// Kept apart from fit-api.ts (which reads the environment) so pure code and tests can use the error type.

export class FitApiError extends Error {
  constructor(
    readonly status: number,
    /** The API's `error` code (`founder_required`, `invalid_range`, `auth_unavailable`, ...); empty when it sent none. */
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`JoyoFit API ${status} ${code}`);
  }

  /** The Pro-only answer of an upload route (402 `founder_required`, `paywall: true`). */
  get paywall(): boolean {
    return this.status === 402;
  }
}
