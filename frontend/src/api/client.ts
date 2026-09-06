/**
 * API client (T057).
 *
 * Handles `401 REAUTH_REQUIRED` globally: the master password was changed on another device,
 * so every key this tab holds is stale. The keyring is cleared immediately — before the user
 * is prompted — because holding stale keys past that point serves no purpose and widens the
 * window in which they sit in memory.
 */
import { lock } from '../vault/keyring.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ReauthHandler = () => void;
let onReauthRequired: ReauthHandler = () => {};
export const setReauthHandler = (handler: ReauthHandler): void => {
  onReauthRequired = handler;
};

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } })
      ?.error;
    const code = err?.code ?? 'VALIDATION_FAILED';

    if (response.status === 401 && code === 'REAUTH_REQUIRED') {
      // Clear first, prompt second.
      lock();
      onReauthRequired();
    }
    throw new ApiError(response.status, code, err?.message ?? 'Request failed', err?.details);
  }

  return payload as T;
}
