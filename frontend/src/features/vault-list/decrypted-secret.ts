/**
 * A secret after decryption, as the interface renders it.
 *
 * Its own module because three components now share it — the container that decrypts, the list
 * column, and the detail pane — and importing it from any one of them would make a cycle.
 */
import type { CustomField } from '../secret-detail/CustomFields.js';

export interface DecryptedSecret {
  id: string;
  title: string;
  templateVersionId: string;
  revision: number;
  keyVersion: number;
  folderId: string | null;
  tagIds: string[];
  fields: Record<string, string>;
  /** This secret's own extra fields, unpacked from the single reserved envelope. */
  custom: CustomField[];
  /**
   * When the secret was last CHANGED (T032). The server sends it on every row and the client
   * used to discard it while decrypting; the detail footer needs it. It answers "last edited",
   * never "last used" — nothing records use, which is why the "Recently used" scope was cut
   * (FR-030a).
   */
  updatedAt: string;
}
