import { resolve } from 'node:path'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './packages/command-console/vite.config.ts'

// `vitest --mode inspect` (the `test:browser:inspect` script) keeps a headed
// browser and the dev server up. Nothing here reaches the library build:
// `vite build` only reads the packages' vite.config.ts.
export default defineConfig(({ mode }) => {
  const inspect = mode === 'inspect'

  // Tests import the packages by name; the names answer with the source (the
  // same map as the `paths` of tsconfig.json).
  const packages = resolve(import.meta.dirname, 'packages')
  const packageAlias = [
    {
      find: /^@dolusoft\/command-protocol$/,
      replacement: resolve(packages, 'command-protocol/src/index.ts')
    },
    {
      find: /^@dolusoft\/command-console-core$/,
      replacement: resolve(packages, 'command-console-core/src/index.ts')
    },
    {
      find: /^@dolusoft\/command-console$/,
      replacement: resolve(packages, 'command-console/src/index.ts')
    }
  ]

  return mergeConfig(viteConfig, {
    resolve: { alias: packageAlias },
    test: {
      coverage: {
        provider: 'v8',
        // The three packages' source. An empty package (a placeholder
        // `export {}`) has no statement, branch or function, so it counts
        // neither for nor against the thresholds: they bite as soon as code
        // exists (CONTRIBUTING.md, "Coverage").
        include: ['packages/*/src/**'],
        exclude: ['packages/*/src/**/*.spec.ts'],
        reporter: ['text', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
        thresholds: {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90
        }
      },
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'happy-dom',
            // Internal unit specs sit next to the code (src/), package specs
            // in packages/*/tests, the Vue behavior specs that use only the
            // public API in tests/contract/unit, the repository checks in
            // tests/repo.
            include: [
              'packages/*/src/**/*.spec.ts',
              'packages/*/tests/**/*.spec.ts',
              'tests/**/*.spec.ts'
            ],
            exclude: [
              '**/node_modules/**',
              '**/*.browser.spec.ts',
              'tests/contract/browser/**'
            ],
            css: false
          }
        },
        {
          extends: true,
          test: {
            name: 'browser',
            include: [
              'tests/contract/browser/**/*.browser.spec.ts',
              'packages/*/tests/**/*.browser.spec.ts'
            ],
            // One page at a time: several pages opening at once burst
            // loopback connections, and on Windows a burst makes a dropped
            // connection more likely (see `api` below).
            maxWorkers: 1,
            testTimeout: 15_000,
            hookTimeout: 15_000,
            teardownTimeout: 10_000,
            // Browser mode serves on this port, on 127.0.0.1, not localhost.
            // On Windows a loopback SYN is now and then left unanswered for
            // a second (os error 10060); bound to one address, Chromium's
            // backup connection reaches the server. A dropped WebSocket is
            // reconnected (patches/@vitest__browser@*.patch).
            // VITEST_BROWSER_PORT lets two clones run browser tests at once.
            api: {
              host: '127.0.0.1',
              port: Number(process.env.VITEST_BROWSER_PORT ?? 51325),
              strictPort: true
            },
            browser: {
              enabled: true,
              // `colorScheme: null` turns off Playwright's default light
              // emulation. In inspect mode CDP listens on 9333.
              provider: playwright({
                contextOptions: { colorScheme: null },
                ...(inspect
                  ? {
                      launchOptions: { args: ['--remote-debugging-port=9333'] }
                    }
                  : {})
              }),
              // Headed by default so a developer sees the page under test;
              // headless in CI (GitHub Actions sets CI=true) or with
              // HEADLESS=1.
              headless:
                !inspect &&
                (process.env.CI === 'true' || process.env.HEADLESS === '1'),
              ui: false,
              screenshotDirectory: 'tests/contract/browser/__screenshots__',
              viewport: { width: 1280, height: 800 },
              instances: [{ browser: 'chromium', name: 'browser' }]
            }
          }
        }
      ]
    }
  })
})
