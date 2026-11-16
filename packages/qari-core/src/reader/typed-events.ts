/** Minimal typed event emitter; listener errors are isolated so one bad handler can't break playback. */
export class TypedEvents<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<Name extends keyof Events>(name: Name, listener: (payload: Events[Name]) => void): () => void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener as (payload: never) => void);
    this.listeners.set(name, set);
    return () => this.off(name, listener);
  }

  off<Name extends keyof Events>(name: Name, listener: (payload: Events[Name]) => void): void {
    this.listeners.get(name)?.delete(listener as (payload: never) => void);
  }

  emit<Name extends keyof Events>(name: Name, payload: Events[Name]): void {
    for (const listener of this.listeners.get(name) ?? []) {
      try {
        (listener as (payload: Events[Name]) => void)(payload);
      }
      catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
