// Deterministic App-only hook driver: child components still use real React.
// Tests exercise App callbacks/effects without a browser or a new test dependency.
let values: unknown[] = [];
let cursor = 0;
let effectCursor = 0;
let effects: { deps: unknown[]; cleanup?: () => void }[] = [];
let pending: (() => void)[] = [];

export function beginRender() { cursor = 0; effectCursor = 0; }
export function resetHooks() {
  for (const effect of effects) effect.cleanup?.();
  values = []; effects = []; pending = [];
  beginRender();
}
export function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
  const index = cursor++;
  if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
  return [values[index] as T, next => {
    values[index] = typeof next === "function" ? (next as (previous: T) => T)(values[index] as T) : next;
  }];
}
export function useEffect(callback: () => void | (() => void), deps: unknown[]) {
  const index = effectCursor++;
  const previous = effects[index];
  if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
    pending.push(() => {
      previous?.cleanup?.();
      effects[index] = { deps, cleanup: callback() || undefined };
    });
  }
}
export function flushEffects() {
  const scheduled = pending;
  pending = [];
  for (const effect of scheduled) effect();
}

// Table callback tests need derived values, not React's memo cache.
export function useMemo<T>(factory: () => T): T { return factory(); }

export function useRef<T>(initial: T): { current: T } {
  return useState(() => ({ current: initial }))[0];
}
export function useId(): string { return useState(() => `test-id-${cursor}`)[0]; }
