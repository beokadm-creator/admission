import type { HttpsCallable } from 'firebase/functions';

type CallableErrorLike = {
  code?: string;
  message?: string;
};

type RetryDelayContext = {
  attempt: number;
  error: CallableErrorLike;
};

type RetryOptions = {
  maxAttempts?: number;
  shouldRetry?: (error: CallableErrorLike, attempt: number) => boolean;
  getDelayMs?: (context: RetryDelayContext) => number;
};

const TRANSIENT_CALLABLE_ERROR_CODES = new Set([
  'functions/aborted',
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/internal',
  'functions/unknown'
]);

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isTransientCallableError(error: CallableErrorLike) {
  return TRANSIENT_CALLABLE_ERROR_CODES.has(String(error?.code || ''));
}

export async function callCallableWithRetry<RequestData, ResponseData>(
  callable: HttpsCallable<RequestData, ResponseData>,
  payload: RequestData,
  options?: RetryOptions
) {
  const maxAttempts = options?.maxAttempts ?? 4;
  let lastError: CallableErrorLike | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callable(payload);
    } catch (error) {
      const normalizedError = (error || {}) as CallableErrorLike;
      lastError = normalizedError;
      const shouldRetry = options?.shouldRetry
        ? options.shouldRetry(normalizedError, attempt)
        : isTransientCallableError(normalizedError);

      if (!shouldRetry || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = options?.getDelayMs
        ? options.getDelayMs({ attempt, error: normalizedError })
        : 1000 + Math.floor(Math.random() * 1000) + (attempt - 1) * 2000;

      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('Callable request failed');
}
