import { useCallback, useRef, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

interface AsyncCallLogOptions {
  callType: string;
  model?: string;
}

interface AsyncCallState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Some results (e.g. callAI's response) carry token usage we want logged —
// duck-typed since useAsyncCall is generic over any async operation, not just callAI.
type WithUsage = { usage?: { inputTokens?: number; outputTokens?: number } };

export function useAsyncCall<T>() {
  const { user } = useAuth();
  const [state, setState] = useState<AsyncCallState<T>>({ data: null, loading: false, error: null });
  const lastCallRef = useRef<{ fn: () => Promise<T>; logOpts?: AsyncCallLogOptions } | null>(null);

  const logUsage = useCallback(async (
    logOpts: AsyncCallLogOptions,
    status: 'success' | 'error',
    result: T | null,
    errorMessage?: string
  ) => {
    if (!user) return;
    try {
      const usage = (result as WithUsage | null)?.usage;
      await addDoc(collection(db, 'users', user.uid, 'aiUsageLogs'), {
        callType: logOpts.callType,
        model: logOpts.model ?? null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        planId: null,
        status,
        ...(errorMessage ? { errorMessage } : {}),
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[useAsyncCall] Failed to write usage log:', e);
    }
  }, [user]);

  const execute = useCallback(async (
    fn: () => Promise<T>,
    logOpts?: AsyncCallLogOptions
  ): Promise<T | null> => {
    lastCallRef.current = { fn, logOpts };
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const result = await fn();
      setState({ data: result, loading: false, error: null });
      if (logOpts) await logUsage(logOpts, 'success', result);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setState(s => ({ ...s, loading: false, error: message }));
      if (logOpts) await logUsage(logOpts, 'error', null, message);
      return null;
    }
  }, [logUsage]);

  const retry = useCallback((): Promise<T | null> => {
    if (!lastCallRef.current) return Promise.resolve(null);
    const { fn, logOpts } = lastCallRef.current;
    return execute(fn, logOpts);
  }, [execute]);

  return { ...state, execute, retry };
}
