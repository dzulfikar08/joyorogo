/**
 * Wraps an async function so calls made while one is already running get that run's result instead of starting
 * another. The next call after it settles (either way) runs again.
 */
export function singleFlight<Args extends unknown[], T>(
  run: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  let running: Promise<T> | null = null;
  return (...args) => {
    running ??= run(...args).finally(() => {
      running = null;
    });
    return running;
  };
}
