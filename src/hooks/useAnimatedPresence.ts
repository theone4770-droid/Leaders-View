import { useEffect, useState } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Keeps overlays, drawers, and screens mounted briefly while their exit
 * animation runs, while guaranteeing zero mount delay when opening and
 * non-blocking pointer events while closing.
 */
export function useAnimatedPresence(isOpen: boolean, exitDurationMs = 160) {
  const [rendered, setRendered] = useState(isOpen);

  if (isOpen && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (isOpen || !rendered) return;

    if (prefersReducedMotion() || exitDurationMs <= 0) {
      setRendered(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setRendered(false);
    }, exitDurationMs);

    return () => window.clearTimeout(timer);
  }, [isOpen, rendered, exitDurationMs]);

  return {
    shouldRender: isOpen || rendered,
    isClosing: !isOpen && rendered,
  };
}
