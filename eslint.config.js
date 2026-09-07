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
      // Prisma's generated client. Thousands of errors from code we do not write and cannot
      // fix, which drowned out real findings until it was ignored here.
      'backend/prisma/generated/',
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

  /**
   * Backend TESTS may reach into the client's crypto, and must.
   *
   * The rule above exists to keep a decryption path out of the shipped server. A test is not
   * shipped, and the only honest way to assert that the server stores ciphertext it cannot read
   * is to encrypt with the real client code and then check the row. Re-implementing the crypto
   * inside the tests would make them agree with themselves rather than with the product.
   *
   * The restriction on pulling client crypto LIBRARIES into backend source still stands: this
   * relaxes the frontend-import group only, and only under tests/.
   */
  {
    files: ['backend/tests/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['hash-wasm', 'otpauth', '@noble/*', '@zxcvbn-ts/*'],
              message:
                'Client-side crypto libraries MUST NOT be used on the server. Drive them ' +
                'through frontend/src/crypto instead, so tests exercise the real client path.',
            },
          ],
        },
      ],
    },
  },
);
