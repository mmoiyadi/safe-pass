/**
 * Folder and tag filter state (T072, FR-047; reduced to types in T023).
 *
 * Folders are exclusive — a secret sits in one folder or none. Tags are additive, and multiple
 * selected tags narrow (AND) rather than widen: picking two tags should show the secrets
 * carrying both, which is what "filter" means to someone using it.
 *
 * The controls that used to live here are now in the rail (`features/shell/VaultRail.tsx`), and
 * the state itself is owned by `App`. What remains is the vocabulary both sides share: `App`
 * holds a `FilterState`, the rail edits it, and `SecretList` applies it.
 */
export interface NamedItem {
  id: string;
  name: string;
}

export interface FilterState {
  /** null means "any folder"; UNFILED means "no folder". */
  folderId: string | null;
  tagIds: string[];
}

export const UNFILED = '__unfiled__';
