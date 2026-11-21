// ESLint flat config – https://docs.expo.dev/guides/using-eslint/
// Alap: eslint-config-expo (React, React Native, TypeScript, import szabályok).
// Prettier: a formázási eltérés ESLint-hibaként jelenik meg (eslint-plugin-prettier).
// A rétegszabályokat (no-restricted-imports) a PHASE 03 adja hozzá (ARCHITECTURE 3.).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ['dist/*', '.expo/*', 'coverage/*', 'android/*', 'ios/*', 'expo-env.d.ts'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      // Típusinformációs lint (a tsconfig.json alapján) – a no-floating-promises szabályhoz kell.
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      // CLAUDE.md: kerüld az `any` típust. Kivétel csak indoklással + eslint-disable kommenttel.
      '@typescript-eslint/no-explicit-any': 'error',
      // Az el nem várt Promise csendes hibát okoz (pl. RNTL 14 aszinkron fireEvent, későbbi API-hívások).
      '@typescript-eslint/no-floating-promises': 'error',
      // Import-konvenció: külső csomagok → belső `@/` alias → relatív importok, csoportonként üres sorral.
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
]);
