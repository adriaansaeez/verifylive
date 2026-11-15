import type { QueueState } from "@/lib/types";

export type QueueTask<T> = {
  run: () => Promise<T>;
  priority: number;
  key?: string;
  onStart?: (waitMs: number) => void;
};

type Waiter<T> = {
  task: QueueTask<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  enqueuedAt: number;
  sequence: number;
};

type StateListener = (state: QueueState) => void;

/**
 * Clef accepts one request at a time per person. Everything in the app funnels
 * through this queue so a fast speech never produces a 429 storm, and final
 * verdicts are always ahead of background re-analysis.
 */
class ClefQueue {
  private queue: Waiter<unknown>[] = [];
  private inFlight = false;
  private completed = 0;
  private failed = 0;
  private lastWaitMs: number | null = null;
  private sequence = 0;
  private readonly dedupe = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<StateListener>();

  state(): QueueState {
    return {
      inFlight: this.inFlight ? 1 : 0,
      waiting: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      lastWaitMs: this.lastWaitMs,
    };
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue<T>(task: QueueTask<T>): Promise<T> {
    if (task.key) {
      const existing = this.dedupe.get(task.key);
      if (existing) return existing as Promise<T>;
    }

    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: task as QueueTask<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
        sequence: this.sequence++,
      });
      this.queue.sort((left, right) =>
        right.task.priority === left.task.priority
          ? left.sequence - right.sequence
          : right.task.priority - left.task.priority,
      );
    });

    if (task.key) {
      const key = task.key;
      this.dedupe.set(key, promise);
      promise.finally(() => this.dedupe.delete(key)).catch(() => undefined);
    }

    this.emit();
    void this.drain();
    return promise;
  }

  private emit(): void {
    const state = this.state();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // A broken listener must never break the queue.
      }
    }
  }

  private async drain(): Promise<void> {
    if (this.inFlight) return;
    const next = this.queue.shift();
    if (!next) {
      this.emit();
      return;
    }
    this.inFlight = true;
    const waitMs = Date.now() - next.enqueuedAt;
    this.lastWaitMs = waitMs;
    next.task.onStart?.(waitMs);
    this.emit();
    try {
      const value = await next.task.run();
      this.completed += 1;
      next.resolve(value);
    } catch (error) {
      this.failed += 1;
      next.reject(error);
    } finally {
      this.inFlight = false;
      this.emit();
      if (this.queue.length > 0) void this.drain();
    }
  }
}

type GlobalWithQueue = typeof globalThis & { __veritasClefQueue?: ClefQueue };

export function getClefQueue(): ClefQueue {
  const store = globalThis as GlobalWithQueue;
  store.__veritasClefQueue ??= new ClefQueue();
  return store.__veritasClefQueue;
}

export const clefQueue = getClefQueue();
