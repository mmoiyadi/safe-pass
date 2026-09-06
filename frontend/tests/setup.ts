// jsdom ships no WebCrypto. Node 22 provides a spec-compliant implementation,
// so the crypto suite runs against the same primitives the browser will use.
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
