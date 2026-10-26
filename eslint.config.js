import process from 'node:process'

import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import importPlugin from 'eslint-plugin-import-x'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vueEslintParser from 'vue-eslint-parser'

import layers from './scripts/eslint-layers.mjs'

// Variables are camelCase; tests may also use UPPER_CASE constants and
// PascalCase component stand-ins.
const namingConvention = variableFormats => [
  'error',
  {
    selector: 'variable',
    format: variableFormats
  },
  {
    selector: 'parameter',
    format: ['camelCase'],
    leadingUnderscore: 'allow'
  },
  {
    selector: 'memberLike',
    modifiers: ['private'],
    format: ['camelCase'],
    leadingUnderscore: 'require'
  },
  {
    selector: 'typeLike',
    format: ['PascalCase']
  }
]

// PRINCIPLES.md P1 (C-50): the console renders, the consumer's commands
// fetch and persist. No network or storage access in any package.
const p1Globals = [
  ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map(name => ({
    name,
    message: 'The console does not use the network; commands do (P1).'
  })),
  ...['localStorage', 'sessionStorage', 'indexedDB'].map(name => ({
    name,
    message: 'The console does not persist state; the consumer does (P1).'
  }))
]
const p1Properties = [
  ...[
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'localStorage',
    'sessionStorage',
    'indexedDB'
  ].flatMap(property =>
    ['window', 'globalThis', 'self'].map(object => ({
      object,
      property,
      message: 'No network or storage access in the library (P1).'
    }))
  ),
  {
    object: 'document',
    property: 'cookie',
    message: 'No storage access in the library (P1).'
  }
]

// The protocol and the core have no DOM, no clock and no timer: the core
// sees `KeyInput`, never a DOM event, and its only scheduling is one
// `Promise.resolve().then` per report of a controlled slice (spec §3.3).
const domFree = [
  'document',
  'window',
  'navigator',
  'performance',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'requestIdleCallback',
  'queueMicrotask'
].map(name => ({
  name,
  message:
    'The protocol and the core have no DOM, clock or timer; the Vue package reads them (P14).'
}))

// Spec §6.6, §7.4 (D-07, C-52): keys are listened to on the input element
// only; the Vue package never listens on the window or the document.
const globalListeners = [
  {
    selector:
      "CallExpression[callee.property.name='addEventListener'][callee.object.name=/^(window|document|globalThis|self)$/]",
    message:
      'Listen on the console elements only, never on window or document (C-52).'
  },
  {
    selector:
      "CallExpression[callee.property.name='addEventListener'][callee.object.property.name=/^(window|document|ownerDocument|defaultView)$/]",
    message:
      'Listen on the console elements only, never on window or document (C-52).'
  }
]

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'temp', '.vitest', 'packages/*/dist']),
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      pluginVue.configs['flat/recommended'],
      // Last of the shared sets: turns off formatting rules that conflict
      // with prettier and adds the prettier/prettier rule.
      prettierRecommended
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.vue']
      },
      globals: globals.browser
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'import-x': importPlugin
    },
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal'],
          pathGroups: [
            // The packages themselves, imported by name in tests. Without
            // this the group depends on whether dist/ exists (self-reference
            // through `exports`): internal after a build, external on a
            // fresh checkout.
            {
              pattern: '@dolusoft/command-*',
              group: 'internal'
            }
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true
          }
        }
      ],
      '@typescript-eslint/naming-convention': namingConvention(['camelCase']),
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/no-multiple-template-root': 'off',
      // S-08: all text is escaped; output is structured blocks (ADR 0005).
      'vue/no-v-html': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      '@typescript-eslint/no-shadow': 'error'
    }
  },
  {
    // Vue SFCs: vue-eslint-parser reads the template and hands <script> to
    // the TypeScript parser.
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueEslintParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: ['.vue']
      }
    }
  },
  {
    // Plain JavaScript (scripts, eslint.config.js) is outside tsconfig.json,
    // so it gets no type information. It runs in Node.
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: globals.node
    }
  },
  {
    // Config files run in Node.
    files: ['*.config.ts', 'packages/*/*.config.ts'],
    languageOptions: { globals: globals.node }
  },
  {
    // Tests run in happy-dom or a real browser and may read Node's
    // `process`; internal specs sit next to the unit they cover.
    files: ['tests/**', 'packages/*/src/**/*.spec.ts', 'packages/*/tests/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/naming-convention': namingConvention([
        'camelCase',
        'UPPER_CASE',
        'PascalCase'
      ])
    }
  },
  {
    // The layers point one way (P14): the protocol imports nothing, the core
    // only the protocol, the Vue package both and vue; inside the core a
    // feature reaches only shared/ and store/. Re-exports and dynamic
    // imports count.
    files: ['packages/*/src/**/*.{ts,vue}'],
    ignores: ['packages/*/src/**/*.spec.ts'],
    plugins: { layers },
    rules: { 'layers/boundaries': 'error' }
  },
  {
    // The library never depends on its tests or their helpers.
    files: ['packages/*/src/**', 'contract/**'],
    ignores: ['packages/*/src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/tests/**', '**/tests', 'tests/**'],
              message: 'Library code must not import from tests/.'
            }
          ]
        }
      ]
    }
  },
  {
    // P1: no network or storage access in the Vue package.
    files: ['packages/command-console/src/**', 'contract/**'],
    ignores: ['packages/*/src/**/*.spec.ts'],
    rules: {
      'no-restricted-globals': ['error', ...p1Globals],
      'no-restricted-properties': ['error', ...p1Properties],
      'no-restricted-syntax': ['error', ...globalListeners]
    }
  },
  {
    // P1 and no DOM, clock or timer in the protocol and the core. It repeats
    // the P1 entries, since a later block replaces a rule's options.
    files: [
      'packages/command-protocol/src/**',
      'packages/command-console-core/src/**'
    ],
    ignores: ['packages/*/src/**/*.spec.ts'],
    rules: {
      'no-restricted-globals': ['error', ...p1Globals, ...domFree],
      'no-restricted-properties': ['error', ...p1Properties]
    }
  }
])
