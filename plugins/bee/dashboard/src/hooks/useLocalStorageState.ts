/**
 * useLocalStorageState — a tiny typed wrapper around React state that mirrors
 * the value into localStorage.
 *
 * Behaviour:
 *   - On first mount, tries to read `localStorage[key]`. If parse succeeds,
 *     that value becomes the initial state. Otherwise `defaultValue` is used.
 *   - Every state change is serialised with `JSON.stringify` and written back
 *     to localStorage. Failures (quota exceeded, private mode) are swallowed
 *     so the dashboard never crashes because of storage issues.
 *   - `validate` lets callers reject stale shapes without hand-rolling a try
 *     block per consumer.
 *   - Cross-tab sync is NOT implemented (Quick 8 scope trim). Each tab keeps
 *     its own copy; the last write wins on reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Updater<T> = T | ((prev: T) => T);

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  options: { validate?: (value: unknown) => value is T } = {},
): [T, (value: Updater<T>) => void] {
  const { validate } = options;

  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed = JSON.parse(raw) as unknown;
      if (validate && !validate(parsed)) return defaultValue;
      return parsed as T;
    } catch (_) {
      return defaultValue;
    }
  });

  const didHydrateRef = useRef(false);

  useEffect(() => {
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (_) {
      // Quota exceeded, private mode, or serialisation failure. Swallow —
      // the dashboard keeps working in memory only.
    }
  }, [key, state]);

  const setStable = useCallback(
    (value: Updater<T>) => {
      setState((prev) => {
        return typeof value === 'function'
          ? (value as (p: T) => T)(prev)
          : value;
      });
    },
    [],
  );

  return [state, setStable];
}
