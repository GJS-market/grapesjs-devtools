/**
 * Trailing-edge debounce. Returns the wrapped function plus `cancel` / `flush`.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const run = () => {
    timer = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, wait);
  }) as Debounced<A>;

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      run();
    }
  };

  return debounced;
}

/**
 * requestAnimationFrame-based throttle: collapses bursts of calls into at most
 * one invocation per frame (trailing args win). Used for scroll/resize overlays.
 */
export function rafThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
): Debounced<A> {
  let raf: number | null = null;
  let lastArgs: A | null = null;

  const run = () => {
    raf = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const throttled = ((...args: A) => {
    lastArgs = args;
    if (raf === null) raf = requestAnimationFrame(run);
  }) as Debounced<A>;

  throttled.cancel = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    lastArgs = null;
  };

  throttled.flush = () => {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      run();
    }
  };

  return throttled;
}
