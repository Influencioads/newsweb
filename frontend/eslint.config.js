import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/**
 * ESLint 9 flat config. Uses only what package.json already installs.
 * `npm run lint` runs with --max-warnings 0, so anything below is an error in CI.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.*', 'scripts/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript owns these; the core rules misfire on TS syntax.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Pages export a default component plus named page components (e.g.
      // LibraryPages.tsx), and the primitive barrels export helpers next to
      // components. Fast refresh still works for the component exports.
      'react-refresh/only-export-components': 'off',
      // The design system bans native prompts: use PromptDialog / ConfirmDialog.
      'no-restricted-globals': ['error', 'prompt', 'confirm', 'alert'],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'prompt', message: 'Use PromptDialog from @/components/ui/Dialog.' },
        { object: 'window', property: 'confirm', message: 'Use ConfirmDialog / useConfirm from @/components/ui/Dialog.' },
        { object: 'window', property: 'alert', message: 'Use useToast from @/components/ui/Toast.' },
      ],
    },
  },
  {
    // Legacy window.prompt call sites, replaced by PromptDialog in W5 (MyEpaper)
    // and W7 (admin). scripts/audit-ui.mjs still counts them; delete this
    // block once it reports 0.
    files: [
      'src/pages/admin/ManagementPages.tsx',
      'src/pages/admin/PublishingPages.tsx',
      'src/pages/public/MyEpaperPage.tsx',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
