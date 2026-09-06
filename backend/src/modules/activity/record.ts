/**
 * Append-only activity log writer (T095).
 *
 * Takes the transaction client so a log entry is written in the same transaction as the change
 * it records — a log that can disagree with the data is worse than no log.
 *
 * The table itself refuses UPDATE and DELETE at the database level (see the migration), so this
 * is the only way a row is ever created and no code path can alter one afterwards.
 */
import type { PrismaClient } from '../../../prisma/generated/client/index.js';

export type Action =
  | 'vault_created'
  | 'vault_deleted'
  | 'invited'
  | 'invitation_ready'
  | 'invitation_completed'
  | 'invitation_withdrawn'
  | 'invitation_expired'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'role_changed'
  | 'rotation_started'
  | 'rotation_completed'
  | 'secret_deleted'
  | 'exported';

export interface Entry {
  vaultId: string;
  actorId?: string | null;
  subjectId?: string | null;
  action: Action;
  /**
   * Non-secret context only — role names, counts, generations. A secret value, a title, or any
   * ciphertext here would survive the deletion of the thing it describes (FR-079).
   */
  metadata?: Record<string, string | number | boolean> | undefined;
}

type Tx = Pick<PrismaClient, 'activityLogEntry'>;

export async function record(tx: Tx, entry: Entry): Promise<void> {
  await tx.activityLogEntry.create({
    data: {
      vaultId: entry.vaultId,
      actorId: entry.actorId ?? null,
      subjectId: entry.subjectId ?? null,
      action: entry.action,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    },
  });
}
