import { useEffect, useRef } from 'react';

/**
 * The Android back button, for screens inside the feed (an open attack chain, a game or sheet on top of it).
 * The newest open screen is asked first; it returns true when it handled the press (closed itself).
 * App.tsx asks here before its own rules (settings, search, back to the latest story, leave the app).
 */
const stack: { current: () => boolean }[] = [];

export function handleBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].current()) return true;
  }
  return false;
}

/** While `active`, a back press calls `fn` first. */
export function useBack(active: boolean, fn: () => boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
