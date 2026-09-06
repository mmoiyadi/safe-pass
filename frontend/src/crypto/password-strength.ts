/**
 * Master password strength (FR-002).
 *
 * Enforced on the client only, because the server never receives the password and so cannot
 * verify its strength. A modified client can bypass this; that is accepted, because a user
 * determined to weaken their own master password is not the threat here. The control exists to
 * stop ACCIDENTAL weak choices on an account that can never be recovered.
 *
 * zxcvbn's dictionaries are ~400KB, so they load lazily — only the registration and
 * change-password screens need them, and never after unlock.
 */
export const MIN_LENGTH = 12;
export const MIN_SCORE = 3;

export interface StrengthResult {
  /** 0 (trivially guessable) to 4 (very strong). */
  score: 0 | 1 | 2 | 3 | 4;
  acceptable: boolean;
  /** Plain-language reasons it was rejected. Never echoes the password itself. */
  problems: string[];
  suggestions: string[];
}

let loaded: Promise<typeof import('@zxcvbn-ts/core')> | null = null;

async function loadZxcvbn() {
  loaded ??= (async () => {
    const core = await import('@zxcvbn-ts/core');
    const common = await import('@zxcvbn-ts/language-common');
    const en = await import('@zxcvbn-ts/language-en');
    // Use the NAMED exports. These packages also ship a default export, but it resolves only
    // under Node's CJS interop — under Vite's ESM it is undefined, and reading `.dictionary`
    // off it throws at runtime with the module loading fine. Found in the browser, not by
    // typechecking, because both shapes typecheck.
    core.zxcvbnOptions.setOptions({
      dictionary: { ...common.dictionary, ...en.dictionary },
      graphs: common.adjacencyGraphs,
      translations: en.translations,
    });
    return core;
  })();
  return loaded;
}

export async function assessMasterPassword(password: string): Promise<StrengthResult> {
  const problems: string[] = [];
  if (password.length < MIN_LENGTH) {
    problems.push(`Use at least ${MIN_LENGTH} characters (currently ${password.length}).`);
  }

  const { zxcvbn } = await loadZxcvbn();
  const result = zxcvbn(password);
  const score = result.score as 0 | 1 | 2 | 3 | 4;

  if (score < MIN_SCORE) {
    problems.push(result.feedback.warning || 'This password is too easy to guess.');
  }

  return {
    score,
    acceptable: problems.length === 0,
    problems,
    suggestions: result.feedback.suggestions ?? [],
  };
}

/** Throwing guard for the enrolment path, so a weak password cannot reach key derivation. */
export async function requireAcceptableMasterPassword(password: string): Promise<void> {
  const result = await assessMasterPassword(password);
  if (!result.acceptable) {
    throw new Error(`Master password rejected: ${result.problems.join(' ')}`);
  }
}
