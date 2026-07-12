import pluginJs from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import securityPlugin from 'eslint-plugin-security';
import sonarjsPlugin from 'eslint-plugin-sonarjs';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';
import tsPlugin from 'typescript-eslint';

// `mock` from `bun:test` is process-global once installed and leaks into every other
// test file the runner loads. Use dependency injection instead. Shared so the
// M365-library fence below can restate it without dropping it.
const BUN_TEST_MOCK = {
  name: 'bun:test',
  importNames: ['mock'],
  message: '`mock` from bun:test is forbidden — it leaks across test files. Use dependency injection: refactor the production code to accept the SDK as a parameter, then pass a fake at construction.',
};

// SPEC §15.1 R3: the send-capable ask-marcel-office-cli library is imported ONLY in the
// composition root and the single Office adapter (src/infra/office.ts). Everywhere else
// reaches M365 through the Office port. scripts/ included — entries call the composition
// root, never the library directly.
const M365_LIBRARY_FENCE = {
  group: ['ask-marcel-office-cli', 'ask-marcel-office-cli/*'],
  message: 'Import ask-marcel-office-cli only in src/composition/** or src/infra/office.ts (SPEC §15.1 R3). Everywhere else, use the Office port.',
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  pluginJs.configs.recommended,
  ...tsPlugin.configs.recommended,
  securityPlugin.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'func-style': ['error', 'expression'],
      'no-console': ['error'],
      'prefer-template': 'error',
      quotes: ['error', 'single', { avoidEscape: true }],
      // no-mock (all files) + M365-library fence (all files; relaxed for the boundary below).
      'no-restricted-imports': ['error', { paths: [BUN_TEST_MOCK], patterns: [M365_LIBRARY_FENCE] }],
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true, allowTypedFunctionExpressions: true }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    },
  },
  {
    // The M365-access boundary (R3): the composition root, the Office adapter + login flow,
    // and their own tests may import the library. The no-mock restriction still holds here.
    files: ['src/composition/**/*.ts', 'src/infra/office.ts', 'src/infra/office.test.ts', 'src/infra/office-login.ts', 'src/infra/office-login.test.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [BUN_TEST_MOCK] }] },
  },
  {
    // SPEC §15.1 R1: the ask-marcel-office binary is never spawned. All M365 access is the
    // Office port (CommandRunner survives for qmd/bun only). Guards against a regressed spawn.
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "Literal[value='ask-marcel-office']", message: 'The ask-marcel-office binary is never spawned (SPEC §15.1 R1). Reach Microsoft 365 through the Office port.' },
      ],
    },
  },
  {
    // Gate scripts (scripts/check-coverage.ts, scripts/regenerate-coverage-preload.ts)
    // are terminal tools, not production code: their whole job is printing to the
    // console that invoked them. The Logger port (rule 4) governs src/**; injecting
    // Winston into a pre-commit gate would be ceremony without observability value.
    // Project-level severity change with a comment — never an inline ignore (rule 15).
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  // Type-aware rules — slow (~25s on full repo), enabled only by
  // `bun run lint:strict` (which sets LINT_STRICT=1) and the pre-commit hook.
  // Inner-loop `bun run lint` does NOT run them.
  ...(process.env['LINT_STRICT']
    ? [
        {
          files: ['src/**/*.ts'],
          languageOptions: {
            parserOptions: {
              projectService: true,
              tsconfigRootDir: import.meta.dirname,
            },
          },
          rules: {
            // Lint-time equivalents of Sonar S4325 (no `!`/`as` non-narrowing assertions)
            // and S6671 (Promise.reject must be an Error).
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/prefer-promise-reject-errors': 'error',
          },
        },
      ]
    : []),
  {
    plugins: { prettier },
    rules: {
      'prettier/prettier': [
        1,
        {
          endOfLine: 'lf',
          printWidth: 180,
          semi: true,
          singleQuote: true,
          tabWidth: 2,
          trailingComma: 'es5',
        },
      ],
    },
  },
  {
    plugins: { unicorn: unicornPlugin },
    rules: {
      'unicorn/empty-brace-spaces': 'off',
      'unicorn/no-null': 'off',
    },
  },
  {
    rules: {
      // false-positive-heavy rules in this codebase's idioms; disabled at project level.
      // Never inline-ignore — change severity here or refactor the code.
      'security/detect-object-injection': 'off',
      'security/detect-unsafe-regex': 'off',
      // detect-non-literal-fs-filename flags `chmodSync(mkdtempSync(...))` in FS-adapter
      // tests. Production code uses Bun.file (not flagged by this rule), so disabling
      // globally loses nothing on the real attack surface.
      'security/detect-non-literal-fs-filename': 'off',
      // detect-non-literal-regexp: the only dynamic RegExp is own-body.ts's signature
      // cut built from the user's OWN display name, passed through escapeRegex first -
      // every metacharacter is neutralized, so there is no injection surface.
      'security/detect-non-literal-regexp': 'off',
    },
  },
  sonarjsPlugin.configs.recommended,
  {
    // SonarJS rule overrides — always-on, justified per rule. See LESSONS.md.
    rules: {
      'sonarjs/no-unused-vars': 'off',          // duplicates @typescript-eslint/no-unused-vars
      'sonarjs/no-empty-test-file': 'off',      // false positives on `describe` test layout
      'sonarjs/cognitive-complexity': 'off',    // we already cap function size; this is noise
    },
  },
  // Non-source paths must not be linted: Stryker copies the tree into .stryker-tmp/
  // during a run, reports/ is output, and the config file itself would trip no-undef
  // on `process` (it runs under Node semantics, not the **/*.ts globals block).
  // scripts/ IS linted — the gate scripts stay under the full rule set, with only
  // no-console turned off for them above.
  {
    ignores: ['eslint.config.js', '.stryker-tmp/**', 'reports/**', 'docs/**', '.claude/**', '.agents/**'],
  },
];
