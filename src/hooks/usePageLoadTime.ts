import { useEffect, useRef } from 'react';

/**
 * Call at top of component.
 * Pass `loading` state — timer stops when loading becomes false.
 * 
 * usePageLoadTime('Home', loading);
 * 
 * Output:
 * ⚡ [Home] data ready in 312ms
 * 🔴 [Labs] data ready in 2100ms  SLOW
 */
export function usePageLoadTime(pageName: string, loading: boolean) {
  const startTime = useRef(performance.now());
  const logged = useRef(false);

  useEffect(() => {
    if (loading) return;           // still loading — wait
    if (logged.current) return;    // already logged once
    logged.current = true;

    const duration = Math.round(performance.now() - startTime.current);
    const emoji = duration < 500 ? '⚡' : duration < 1500 ? '🟡' : '🔴';
    const label = duration < 500 ? 'fast' : duration < 1500 ? 'ok' : 'SLOW — needs attention';

    console.log(
      `%c${emoji} [${pageName}] data ready in ${duration}ms %c${label}`,
      'font-weight: bold; font-size: 12px;',
      duration < 500
        ? 'color: #10b981'
        : duration < 1500
        ? 'color: #f59e0b'
        : 'color: #ef4444; font-weight: bold'
    );
  }, [loading]);
}

/**
 * Time a specific async operation.
 * const t = startTimer('fetchHabits'); await ...; t.end();
 */
export function startTimer(label: string) {
  const start = performance.now();
  return {
    end: () => {
      const ms = Math.round(performance.now() - start);
      const emoji = ms < 300 ? '⏱' : ms < 1000 ? '⚠️' : '🐢';
      console.log(
        `%c${emoji} ${label}: ${ms}ms`,
        ms < 300 ? 'color: #6b7280' : ms < 1000 ? 'color: #f59e0b' : 'color: #ef4444; font-weight: bold'
      );
      return ms;
    }
  };
}