/** A tiny external store with selector subscriptions (avoids re-rendering the whole tree at 60 fps). */
import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export function useStore<T, S>(store: Store<T>, selector: (s: T) => S, equal: (a: S, b: S) => boolean = Object.is): S {
  const last = useRef<{ v: S } | null>(null);
  const get = useCallback(() => {
    const next = selector(store.get());
    if (last.current && equal(last.current.v, next)) return last.current.v;
    last.current = { v: next };
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selector]);
  return useSyncExternalStore(store.subscribe, get, get);
}
