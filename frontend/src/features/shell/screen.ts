/**
 * Which top-level screen is showing.
 *
 * Lives here rather than in `App.tsx` so the rail can name it without importing the component
 * that renders the rail — a cycle that would exist only to share a union of seven strings.
 */
export type Screen = 'unlock' | 'register' | 'forgot' | 'vault' | 'settings' | 'organise' | 'sharing';
