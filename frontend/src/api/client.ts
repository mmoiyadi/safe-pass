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

/**
 * Writes are refused while the device has no network (T128, FR-057).
 *
 * Offline support here is deliberately read-only. Accepting an edit offline would mean queuing
 * it, and a queue implies conflict resolution — deciding, later and unattended, whose version of
 * a secret wins. In a password manager the losing side of that decision is a credential someone
 * may need, and the user would not be watching when it was made. Refusing up front is worse UX
 * for a moment and better behaviour forever.
 *
 * `navigator.onLine` is only ever trusted in the negative direction: false is reliable (there is
 * no interface up), while true means very little. So this refuses when the browser is certain
 * there is no network, and otherwise lets the request go and fail on its own terms.
 */
const isDefinitelyOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (WRITE_METHODS.has(method) && isDefinitelyOffline()) {
    throw new ApiError(
      0,
      'OFFLINE',
      'This device is offline. You can read your vault, but creating, editing, deleting, and ' +
        'sharing all need a connection — nothing is queued, so no change is lost or applied ' +
        'behind your back. Reconnect and try again.',
    );
  }

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // fetch rejects with a bare TypeError for every transport failure. Surfacing "Failed to
    // fetch" to someone trying to reach their passwords tells them nothing about what to do.
    throw new ApiError(
      0,
      'NETWORK_UNREACHABLE',
      'Could not reach the server. Check your connection — anything already cached on this ' +
        'device is still readable offline.',
    );
  }

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

    /*
     * Tell "the server said no" apart from "there is no server".
     *
     * A bare `fetch` rejection is not the only way the app server goes missing: a reverse proxy
     * in front of it answers with a 502/503/504, and a dev proxy with a 500 carrying no body.
     * Those are HTTP responses, so fetch resolves happily — and treating them as a rejected
     * password would tell a user offline on a train that their master password is wrong.
     *
     * This API always answers with a structured `error`, so a 5xx WITHOUT one did not come from
     * the application at all.
     */
    const gatewayFailure = response.status === 502 || response.status === 503 || response.status === 504;
    if (gatewayFailure || (response.status >= 500 && !err)) {
      throw new ApiError(
        response.status,
        'NETWORK_UNREACHABLE',
        'Could not reach the server. Anything already stored on this device is still readable ' +
          'offline.',
      );
    }

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
