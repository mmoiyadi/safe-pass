// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/playwright-report/',
      '**/test-results/',
      'specs/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Constitution Principle I, enforced as a lint error rather than a convention.
  // The server must have no code path that can perform decryption, so it must not be able
  // to reach the client's crypto module at all. See contracts/crypto-envelope.md.
  {
    files: ['backend/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/frontend/**', '@pm/frontend*'],
              message:
                'Backend code MUST NOT import from frontend. All cryptography lives in ' +
                'frontend/src/crypto and the server has no key material — importing it would ' +
                'create a server-side decryption path (Constitution Principle I).',
            },
            {
              group: ['hash-wasm', 'otpauth', '@noble/*', '@zxcvbn-ts/*'],
              message:
                'Client-side crypto libraries MUST NOT be used on the server. The server ' +
                'stores opaque ciphertext and derives nothing (Constitution Principle I).',
            },
          ],
        },
      ],
    },
  },

  // Ciphertext must never be logged or stringified for diagnostics.
  {
    files: ['backend/**/*.ts', 'frontend/src/**/*.ts', 'frontend/src/**/*.tsx'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      // A leading underscore marks a parameter that must exist for its position in a
      // signature but is deliberately unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: { 'no-console': 'off' },
  },
);
