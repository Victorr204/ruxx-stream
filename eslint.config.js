// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*'],
  },
  {
    files: ['supabase/functions/**/*.ts'],
    rules: {
      // `npm:` specifiers are resolved by the Deno runtime at deploy time,
      // not by Metro's resolver, so the RN-oriented lint rule can't see them.
      'import/no-unresolved': 'off',
    },
  },
]);
