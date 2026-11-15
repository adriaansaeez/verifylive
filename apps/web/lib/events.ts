import type { QueueState, SessionEvent } from "@/lib/types";
import { clefQueue } from "@/lib/clef/queue";

type Listener = (event: SessionEvent) => void;

type GlobalWithBus = typeof globalThis & {
  __veritasBus?: Map<string, Set<Listener>>;
  __veritasQueueHooked?: boolean;
};

function listeners(): Map<string, Set<Listener>> {
  const store = globalThis as GlobalWithBus;
  store.__veritasBus ??= new Map();
  return store.__veritasBus;
}

function hookQueue(): void {
  const store = globalThis as GlobalWithBus;
  if (store.__veritasQueueHooked) return;
  store.__veritasQueueHooked = true;
  clefQueue.onChange((queue) => {
    for (const sessionId of listeners().keys()) {
      publish(sessionId, { type: "queue.updated", queue });
    }
  });
}

export function subscribe(sessionId: string, listener: Listener): () => void {
  hookQueue();
  const map = listeners();
  const set = map.get(sessionId) ?? new Set<Listener>();
  set.add(listener);
  map.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) map.delete(sessionId);
  };
}

export function publish(sessionId: string, event: SessionEvent): void {
  const set = listeners().get(sessionId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // A broken SSE stream must never break the analysis pipeline.
    }
  }
}

export function publishQueueState(sessionId: string): void {
  const queue: QueueState = clefQueue.state();
  publish(sessionId, { type: "queue.updated", queue });
}
