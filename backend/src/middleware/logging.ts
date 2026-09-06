/**
 * Log redaction (FR-020, and the constitution's data-protection standards).
 *
 * Logs, error messages, telemetry, and crash reports MUST NOT contain secret values, master
 * passwords, derived keys, decrypted payloads, or TOTP seeds. The server never holds a
 * plaintext secret, but it does receive AuthHashes and ciphertext envelopes — neither belongs
 * in a log sink, and an envelope in a log is an offline-attackable artefact sitting outside
 * the database's protections.
 */

/** Field names that must never be serialized into a log line, at any depth. */
export const REDACTED_KEYS = [
  'authHash',
  'currentAuthHash',
  'newAuthHash',
  'password',
  'masterPassword',
  'wrappedUserKey',
  'newWrappedUserKey',
  'wrappedPrivateKey',
  'wrappedVaultKey',
  'wrappedSecret',
  'title',
  'name',
  'fieldValues',
  'vaultName',
  'secrets',
  'folders',
  'tags',
  'memberKeys',
  'proof',
  'token',
  'cookie',
] as const;

const paths: string[] = [];
for (const key of REDACTED_KEYS) {
  paths.push(key, `*.${key}`, `*.*.${key}`, `req.body.${key}`, `req.body.*.${key}`);
}
paths.push('req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]');

export const loggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: { paths, censor: '[REDACTED]' },
  serializers: {
    // Only what is needed to correlate a request. Never the body.
    req(request: { id: string; method: string; url: string }) {
      return { id: request.id, method: request.method, url: request.url.split('?')[0] ?? '' };
    },
  },
} as const;

/**
 * Belt and braces: strip anything that looks like an envelope before it reaches a sink,
 * even under a key not on the list above. Envelopes are base64url and start with the
 * version+algorithm header (0x01 0x01), which encodes to "AQE".
 */
export function scrubEnvelopes(value: string): string {
  return value.replace(/\bAQE[A-Za-z0-9_-]{20,}\b/g, '[ENVELOPE]');
}
