// Serialise reads and discard results after disposal. A change arriving during a
// request schedules another read, so an older snapshot cannot win a race.
export function createRefreshQueue<T>(read: () => Promise<T>, apply: (value: T) => void, fail: (error: unknown) => void) {
  let disposed = false, running = false, pending = false;
  async function refresh() {
    if (disposed) return;
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending && !disposed) {
        pending = false;
        try {
          const value = await read();
          if (!disposed && !pending) apply(value);
        } catch (error) {
          if (!disposed) fail(error);
        }
      }
    } finally { running = false; }
  }
  return { refresh, dispose() { disposed = true; pending = false; } };
}
