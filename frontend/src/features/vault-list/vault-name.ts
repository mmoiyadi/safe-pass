/**
 * A vault summary with its name decrypted (moved from `VaultSwitcher.tsx`, T023/T024).
 *
 * The name is encrypted under the vault's own key, so it exists in plaintext only after unlock
 * and only in memory. The type lives in its own module because the component that used to
 * export it is gone: the rail renders vault rows now.
 */
import type { VaultSummary } from '@pm/shared';

export interface VaultWithName extends VaultSummary {
  decryptedName: string;
}
