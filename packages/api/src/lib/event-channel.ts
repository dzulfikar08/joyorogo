/**
 * A push-to-pull bridge: producers call `push`, one consumer iterates. Lets a
 * callback-style job (the vision stream reporting items) feed an async
 * generator handler. Events pushed before the consumer asks are queued; after
 * `close` the iterator drains the queue and ends; after `fail` it drains and
 * then throws the error.
 */
export class EventChannel<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private closed = false;
  private failure: { error: unknown } | null = null;
  private wake: (() => void) | null = null;

  push(event: T): void {
    if (this.closed) return;
    this.queue.push(event);
    this.notify();
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.failure = { error };
    this.close();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void> {
    for (;;) {
      while (this.queue.length > 0) yield this.queue.shift()!;
      if (this.closed) {
        if (this.failure) throw this.failure.error;
        return;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}
