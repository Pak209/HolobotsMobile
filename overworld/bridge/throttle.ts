type TimerOptions = {
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
  now?: () => number;
};

export const createTrailingThrottle = <T>(fn: (value: T) => void, intervalMs: number, options: TimerOptions = {}) => {
  const schedule = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number);
  const cancel = options.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
  const now = options.now ?? (() => performance.now());
  let lastSentAt = -Infinity;
  let pending: T | undefined;
  let timer: number | undefined;
  let disposed = false;

  const flush = () => {
    timer = undefined;
    if (disposed || pending === undefined) return;
    const value = pending; pending = undefined; lastSentAt = now(); fn(value);
  };

  return {
    push(value: T) {
      if (disposed) return;
      const remaining = intervalMs - (now() - lastSentAt);
      if (remaining <= 0 && timer === undefined) {
        lastSentAt = now(); fn(value); return;
      }
      pending = value;
      if (timer === undefined) timer = schedule(flush, Math.max(0, remaining));
    },
    dispose() {
      disposed = true; pending = undefined;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
  };
};
