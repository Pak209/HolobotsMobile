export type HandshakeState = "connecting" | "connected" | "reconnecting" | "mismatch";

type Timer = (fn: () => void, ms: number) => number;

export type HandshakeControllerOptions = {
  sendHello: () => Promise<unknown>;
  onStateChange: (state: HandshakeState, detail?: { attempt: number; error?: string }) => void;
  isMismatchError: (error: unknown) => boolean;
  setTimeout?: Timer;
  clearTimeout?: (id: number) => void;
  maxAttempts?: number;
  /** Delays before attempts 1..N. Request duration (currently up to 5 s) is additional. */
  backoffMs?: number[];
};

export function createHandshakeController(options: HandshakeControllerOptions) {
  const schedule = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number);
  const cancel = options.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
  const maxAttempts = options.maxAttempts ?? 3;
  const backoff = options.backoffMs ?? [0, 1000, 2500];
  const reconnectDelay = 5000;
  let state: HandshakeState = "connecting";
  let timer: number | undefined;
  let generation = 0;
  let disposed = false;

  const notify = (next: HandshakeState, attempt: number, error?: unknown) => {
    state = next;
    options.onStateChange(next, {
      attempt,
      error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    });
  };

  const queue = (attempt: number, delay: number, token: number, keepMismatch = false) => {
    if (timer !== undefined) cancel(timer);
    timer = schedule(() => {
      timer = undefined;
      if (disposed || token !== generation) return;
      void options.sendHello().then(
        () => {
          if (!disposed && token === generation) notify("connected", attempt);
        },
        (error) => {
          if (disposed || token !== generation) return;
          if (options.isMismatchError(error)) {
            notify("mismatch", attempt, error);
            return;
          }
          if (keepMismatch) {
            notify("mismatch", attempt, error);
            return;
          }
          const nextAttempt = attempt + 1;
          if (attempt < maxAttempts) {
            notify("connecting", nextAttempt, error);
            queue(nextAttempt, backoff[nextAttempt - 1] ?? backoff.at(-1) ?? 0, token);
          } else {
            notify("reconnecting", nextAttempt, error);
            queue(nextAttempt, reconnectDelay, token);
          }
        },
      );
    }, delay);
  };

  const begin = (preserveState: boolean) => {
    if (disposed) return;
    generation += 1;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    const keepMismatch = preserveState && state === "mismatch";
    if (!preserveState) notify("connecting", 1);
    queue(1, 0, generation, keepMismatch);
  };

  return {
    start: () => begin(false),
    resume: () => begin(state === "connected" || state === "mismatch"),
    dispose: () => {
      disposed = true;
      generation += 1;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
    getState: () => state,
  };
}
