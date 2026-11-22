// ESLint flat config – https://docs.expo.dev/guides/using-eslint/
// Alap: eslint-config-expo (React, React Native, TypeScript, import szabályok).
// Prettier: a formázási eltérés ESLint-hibaként jelenik meg (eslint-plugin-prettier).
// Rétegszabályok (ARCHITECTURE 3., D-038): import/no-restricted-paths + no-restricted-imports
// + no-restricted-globals. Új csomag nem kellett (az eslint-plugin-import az expo configból jön).
const fs = require('node:fs');

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

// Windows: a kanonikus útvonal (C:\ vs c:\) kell, különben a zónák útvonal-összevetése elcsúszhat.
const projectRoot = fs.realpathSync.native(__dirname);

// --- Rétegszabályok -------------------------------------------------------------------------

/** UI- és platformcsomagok, amelyeket a tiszta rétegek nem importálhatnak. */
const UI_AND_PLATFORM_PACKAGES = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'UI-függőség ebben a rétegben tilos (ARCHITECTURE 3.).',
  },
  {
    group: ['react-native', 'react-native/*', 'react-native-*'],
    message: 'Platform-függőség ebben a rétegben tilos.',
  },
  {
    group: ['expo', 'expo/*', 'expo-*', '@expo/*'],
    message: 'Expo-függőség ebben a rétegben tilos.',
  },
];

/** Közvetlen hálózati hívás tiltása: adat csak use case-en / gateway-en át érkezhet. */
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  name,
  message: `Közvetlen hálózati hívás (${name}) itt tilos. Use case-en és gateway-en (src/infrastructure) át kérj adatot (ARCHITECTURE 3.).`,
}));

const layerZones = [
  {
    target: './src/domain',
    from: './src',
    except: ['./domain'],
    message: 'A domain csak önmagát importálhatja (tiszta TypeScript).',
  },
  {
    target: './src/contracts',
    from: './src',
    except: ['./contracts', './domain'],
    message: 'A contracts csak a domaint importálhatja.',
  },
  {
    // PHASE 05 (D-055): a számítási motor tiszta – csak a domaint látja.
    target: './src/calculations',
    from: './src',
    except: ['./calculations', './domain'],
    message: 'A calculations csak a domaint importálhatja (tiszta képletek, ARCHITECTURE 3.).',
  },
  {
    // PHASE 10 (D-073): a score-/döntési engine tiszta szabálymotor – domain + calculations.
    target: './src/scoring',
    from: './src',
    except: ['./scoring', './domain', './calculations'],
    message: 'A scoring csak a domaint és a calculations-t importálhatja (ARCHITECTURE 3.).',
  },
  {
    target: './src/application',
    from: './src',
    except: ['./application', './domain', './contracts', './calculations', './scoring'],
    message:
      'Az application nem függhet konkrét adaptertől, UI-tól vagy szervertől – portot használj.',
  },
  {
    target: './src/infrastructure',
    from: ['./src/app', './src/presentation', './src/server', './src/config'],
    message: 'Az infrastructure nem importálhat UI-t, szervert vagy a composition rootot.',
  },
  {
    target: './src/presentation',
    from: ['./src/infrastructure', './src/server', './src/config', './src/contracts'],
    message: 'A presentation csak use case-eken át (useAppServices) ér el adatot.',
  },
  {
    // A src/app/api/**/+api.ts proxy-route-ok külön blokkban kivételt kapnak (lent).
    target: './src/app',
    from: ['./src/infrastructure', './src/server', './src/contracts'],
    message: 'A route-ok (képernyők) nem érhetik el közvetlenül az adaptereket vagy a szervert.',
  },
  {
    // PHASE 04A: a kliens composition rootja sem húzhat be szerverkódot (titkok a bundle-ben!).
    target: './src/config',
    from: './src/server',
    message:
      'A kliens (src/config) soha nem importálhat src/server-t – a titkok a bundle-be kerülnének.',
  },
  {
    // PHASE 04A: a szerver csak a domaint és a közös szerződést látja.
    target: './src/server',
    from: [
      './src/app',
      './src/presentation',
      './src/infrastructure',
      './src/config',
      './src/application',
    ],
    message: 'A src/server csak a domaint és a contracts-ot importálhatja (ARCHITECTURE 3.).',
  },
];

/** A proxy-route-ok (src/app/api/**) zónái: a szervert elérhetik, a kliensoldali rétegeket nem. */
const apiRouteZones = [
  ...layerZones.filter((zone) => zone.target !== './src/app'),
  {
    target: './src/app/api',
    from: [
      './src/infrastructure',
      './src/presentation',
      './src/config',
      './src/application',
      './src/contracts',
    ],
    message: 'A +api.ts route vékony: csak a src/server handlereit hívhatja.',
  },
];

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
      // Rétegek közti importirány (ARCHITECTURE 3. táblázat).
      'import/no-restricted-paths': ['error', { basePath: projectRoot, zones: layerZones }],
    },
  },
  {
    // Domain: semmilyen külső csomag (csak relatív és `@/domain` import).
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/|@/domain(?:/|$))',
              message:
                'A domain nem importálhat külső csomagot (React, Expo, zod…) – tiszta TypeScript.',
            },
          ],
        },
      ],
    },
  },
  {
    // Calculations (PHASE 05): semmilyen külső csomag – csak relatív, `@/domain` és saját import.
    files: ['src/calculations/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/|@/domain(?:/|$)|@/calculations(?:/|$))',
              message:
                'A calculations nem importálhat külső csomagot (React, Expo, zod…) – tiszta TypeScript.',
            },
          ],
        },
      ],
    },
  },
  {
    // Scoring (PHASE 10): semmilyen külső csomag – csak relatív, `@/domain`, `@/calculations`.
    files: ['src/scoring/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/|@/domain(?:/|$)|@/calculations(?:/|$)|@/scoring(?:/|$))',
              message:
                'A scoring nem importálhat külső csomagot (React, Expo, zod…) – tiszta TypeScript.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/contracts/**/*.{ts,tsx}',
      'src/application/**/*.{ts,tsx}',
      'src/server/**/*.{ts,tsx}',
    ],
    rules: { 'no-restricted-imports': ['error', { patterns: UI_AND_PLATFORM_PACKAGES }] },
  },
  {
    // A proxy-route-ok saját zónakészletet kapnak (felülírja a fenti általános beállítást).
    files: ['src/app/api/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': ['error', { basePath: projectRoot, zones: apiRouteZones }],
    },
  },
  {
    // Hálózati hívás csak az infrastructure (proxy kliens) és a jövőbeli src/server rétegben lehet.
    files: [
      'src/domain/**/*.{ts,tsx}',
      'src/calculations/**/*.{ts,tsx}',
      'src/scoring/**/*.{ts,tsx}',
      'src/contracts/**/*.{ts,tsx}',
      'src/application/**/*.{ts,tsx}',
      'src/presentation/**/*.{ts,tsx}',
      'src/app/**/*.{ts,tsx}',
    ],
    ignores: ['src/app/api/**'],
    rules: { 'no-restricted-globals': ['error', ...NETWORK_GLOBALS] },
  },
]);
