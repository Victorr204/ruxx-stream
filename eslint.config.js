// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'desktop/release/*'],
  },
  {
    files: ['supabase/functions/**/*.ts'],
    rules: {
      // `npm:` specifiers are resolved by the Deno runtime at deploy time,
      // not by Metro's resolver, so the RN-oriented lint rule can't see them.
      'import/no-unresolved': 'off',
    },
  },
  {
    // The Electron shell is plain Node commonjs — no bundler, no RN.
    files: ['desktop/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        module: 'writable',
        process: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      'import/no-unresolved': 'off',
      'import/no-commonjs': 'off',
    },
  },
]);
